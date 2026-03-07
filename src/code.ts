import type {
  UIMessage,
  InstanceInfo,
  LibraryGroup,
  ScanScope,
  VariableCollectionData,
  VariableData,
  VariableValue,
  TextStyleData,
  TextStylePropertyData,
} from "./shared/messages";

declare const __html__: string;

figma.showUI(__html__, { width: 340, height: 520, themeColors: true });

figma.ui.onmessage = async (msg: UIMessage) => {
  switch (msg.type) {
    case "scan":
      handleScan(msg.scope);
      break;
    case "navigate":
      handleNavigate(msg.nodeId, msg.pageId);
      break;
    case "detach":
      handleDetach(msg.nodeId);
      break;
    case "detach-library":
      handleDetachLibrary(msg.nodeIds);
      break;
    case "reset":
      handleReset(msg.nodeId);
      break;
    case "reset-library":
      handleResetLibrary(msg.nodeIds);
      break;
    case "fetch-variables":
      await handleFetchVariables();
      break;
  }
};

function handleScan(scope: ScanScope) {
  figma.ui.postMessage({ type: "scan-progress", status: "Scanning…" });

  const pages: readonly PageNode[] =
    scope === "page" ? [figma.currentPage] : figma.root.children;

  const libraryMap = new Map<string, LibraryGroup>();

  for (const page of pages) {
    const instances = page.findAllWithCriteria({ types: ["INSTANCE"] });

    for (const node of instances) {
      const instance = node as InstanceNode;
      const mainComp = instance.mainComponent;
      if (!mainComp) continue;

      const lib = deriveLibraryInfo(mainComp);

      const info: InstanceInfo = {
        nodeId: instance.id,
        name: instance.name,
        pageId: page.id,
        pageName: page.name,
        parentName: instance.parent?.name ?? "",
        componentName: getComponentDisplayName(mainComp),
        componentKey: mainComp.key,
        isRemote: mainComp.remote,
      };

      let group = libraryMap.get(lib.key);
      if (!group) {
        group = {
          libraryKey: lib.key,
          libraryName: lib.name,
          isRemote: lib.isRemote,
          instances: [],
        };
        libraryMap.set(lib.key, group);
      }
      group.instances.push(info);
    }
  }

  const libraries = Array.from(libraryMap.values()).sort((a, b) => {
    if (a.isRemote !== b.isRemote) return a.isRemote ? -1 : 1;
    return a.libraryName.localeCompare(b.libraryName);
  });

  figma.ui.postMessage({ type: "scan-result", libraries });
}

function deriveLibraryInfo(component: ComponentNode): {
  key: string;
  name: string;
  isRemote: boolean;
} {
  if (!component.remote) {
    return { key: "local", name: "Local Components", isRemote: false };
  }

  const displayName = getComponentDisplayName(component);
  const slashIdx = displayName.indexOf("/");
  if (slashIdx > 0) {
    const prefix = displayName.substring(0, slashIdx).trim();
    return { key: `remote:${prefix}`, name: prefix, isRemote: true };
  }

  return {
    key: `remote:${component.key}`,
    name: displayName,
    isRemote: true,
  };
}

function getComponentDisplayName(component: ComponentNode): string {
  if (component.parent?.type === "COMPONENT_SET") {
    return component.parent.name;
  }
  return component.name;
}

function handleNavigate(nodeId: string, pageId: string) {
  const page = figma.root.children.find((p) => p.id === pageId);
  if (!page) return;

  if (figma.currentPage !== page) {
    figma.currentPage = page;
  }

  const node = figma.getNodeById(nodeId);
  if (node && node.type !== "DOCUMENT" && node.type !== "PAGE") {
    const scene = node as SceneNode;
    figma.currentPage.selection = [scene];
    figma.viewport.scrollAndZoomIntoView([scene]);
  }
}

function handleDetach(nodeId: string) {
  const node = figma.getNodeById(nodeId);
  if (node && node.type === "INSTANCE") {
    (node as InstanceNode).detachInstance();
    figma.ui.postMessage({
      type: "detach-result",
      success: true,
      detachedCount: 1,
    });
  } else {
    figma.ui.postMessage({
      type: "detach-result",
      success: false,
      detachedCount: 0,
    });
  }
}

function handleDetachLibrary(nodeIds: string[]) {
  let detached = 0;
  for (const id of nodeIds) {
    const node = figma.getNodeById(id);
    if (node && node.type === "INSTANCE") {
      (node as InstanceNode).detachInstance();
      detached++;
    }
  }
  figma.ui.postMessage({
    type: "detach-result",
    success: detached > 0,
    detachedCount: detached,
  });
}

function handleReset(nodeId: string) {
  try {
    const node = figma.getNodeById(nodeId);
    if (node && node.type === "INSTANCE") {
      (node as InstanceNode).removeOverrides();
      figma.ui.postMessage({
        type: "reset-result",
        success: true,
        resetCount: 1,
      });
    } else {
      figma.ui.postMessage({
        type: "reset-result",
        success: false,
        resetCount: 0,
      });
    }
  } catch (e) {
    figma.ui.postMessage({
      type: "reset-result",
      success: false,
      resetCount: 0,
    });
  }
}

function handleResetLibrary(nodeIds: string[]) {
  let resetCount = 0;
  try {
    for (const id of nodeIds) {
      const node = figma.getNodeById(id);
      if (node && node.type === "INSTANCE") {
        (node as InstanceNode).removeOverrides();
        resetCount++;
      }
    }
  } catch (_e) {
    // Continue; we still report how many succeeded before the error
  }
  figma.ui.postMessage({
    type: "reset-result",
    success: resetCount > 0,
    resetCount,
  });
}

async function handleFetchVariables() {
  const collections =
    await figma.variables.getLocalVariableCollectionsAsync();

  const result: VariableCollectionData[] = [];

  for (const col of collections) {
    const variables: VariableData[] = [];

    for (const varId of col.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(varId);
      if (!variable) continue;

      const valuesByMode: Record<string, VariableValue> = {};
      for (const [modeId, raw] of Object.entries(variable.valuesByMode)) {
        valuesByMode[modeId] = serializeValue(raw);
      }

      variables.push({
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType,
        valuesByMode,
      });
    }

    result.push({
      id: col.id,
      name: col.name,
      modes: col.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      variables,
    });
  }

  const localTextStyles = await figma.getLocalTextStylesAsync();
  const textStyles: TextStyleData[] = localTextStyles.map((ts) => {
    const bv = ts.boundVariables ?? {};

    function prop(
      variableBinding: { type: "VARIABLE_ALIAS"; id: string } | undefined,
      raw: string | number,
    ): TextStylePropertyData {
      return {
        variableId: variableBinding?.id ?? null,
        rawValue: raw,
      };
    }

    const lineHeightRaw =
      ts.lineHeight.unit === "AUTO" ? 0 : ts.lineHeight.value;

    return {
      id: ts.id,
      name: ts.name,
      fontFamily: prop(bv.fontFamily as { type: "VARIABLE_ALIAS"; id: string } | undefined, ts.fontName.family),
      fontSize: prop(bv.fontSize as { type: "VARIABLE_ALIAS"; id: string } | undefined, ts.fontSize),
      lineHeight: prop(bv.lineHeight as { type: "VARIABLE_ALIAS"; id: string } | undefined, lineHeightRaw),
      fontWeight: prop(bv.fontWeight as { type: "VARIABLE_ALIAS"; id: string } | undefined, ts.fontName.style),
      letterSpacing: prop(bv.letterSpacing as { type: "VARIABLE_ALIAS"; id: string } | undefined, ts.letterSpacing.value),
    };
  });

  figma.ui.postMessage({ type: "variables-result", collections: result, textStyles });
}

function serializeValue(raw: unknown): VariableValue {
  if (typeof raw === "object" && raw !== null && "type" in raw) {
    const alias = raw as { type: string; id: string };
    if (alias.type === "VARIABLE_ALIAS") {
      return { type: "VARIABLE_ALIAS", id: alias.id };
    }
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "r" in raw &&
    "g" in raw &&
    "b" in raw
  ) {
    const c = raw as { r: number; g: number; b: number; a?: number };
    return { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 };
  }
  if (typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean") {
    return raw;
  }
  return String(raw);
}
