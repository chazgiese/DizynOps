import type {
  UIMessage,
  InstanceInfo,
  LibraryGroup,
  RemoteLibraryGroup,
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
    case "load-pat": {
      const stored = await figma.clientStorage.getAsync("figma-pat");
      figma.ui.postMessage({ type: "pat-loaded", pat: stored ?? "" });
      break;
    }
    case "save-pat":
      await figma.clientStorage.setAsync("figma-pat", msg.pat);
      break;
    case "clear-pat":
      await figma.clientStorage.deleteAsync("figma-pat");
      break;
    case "open-url":
      figma.openExternal(msg.url);
      break;
  }
};

function handleScan(scope: ScanScope) {
  figma.ui.postMessage({ type: "scan-progress", status: "Scanning…" });

  const pages: readonly PageNode[] =
    scope === "page" ? [figma.currentPage] : figma.root.children;

  const libraryMap = new Map<
    string,
    { libraryName: string; isRemote: boolean; componentMap: Map<string, LibraryGroup> }
  >();

  for (const page of pages) {
    const instances = page.findAllWithCriteria({ types: ["INSTANCE"] });

    for (const node of instances) {
      const instance = node as InstanceNode;
      const mainComp = instance.mainComponent;
      if (!mainComp) continue;
      if (!mainComp.remote) continue;

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

      const componentName = info.componentName;

      // Use the COMPONENT_SET key (groups all variants together) or the
      // component's own key for standalone components. This prevents components
      // with the same display name from different libraries being merged.
      const componentSetKey =
        mainComp.parent?.type === "COMPONENT_SET"
          ? ((mainComp.parent as ComponentSetNode).key || mainComp.key)
          : mainComp.key;
      const groupKey = componentSetKey;

      // Strip the library name prefix from the display name so the card title
      // doesn't repeat what the sticky section header already shows.
      const libPrefix = lib.name + "/";
      const displayComponentName = componentName.startsWith(libPrefix)
        ? componentName.substring(libPrefix.length)
        : componentName;

      let libEntry = libraryMap.get(lib.key);
      if (!libEntry) {
        libEntry = {
          libraryName: lib.name,
          isRemote: lib.isRemote,
          componentMap: new Map(),
        };
        libraryMap.set(lib.key, libEntry);
      }

      let group = libEntry.componentMap.get(groupKey);
      if (!group) {
        group = {
          libraryKey: lib.key,
          libraryName: lib.name,
          componentName: displayComponentName,
          componentSetKey,
          isRemote: lib.isRemote,
          instances: [],
        };
        libEntry.componentMap.set(groupKey, group);
      }
      group.instances.push(info);
    }
  }

  const libraries: RemoteLibraryGroup[] = Array.from(libraryMap.entries())
    .sort(([keyA, a], [keyB, b]) => {
      if (a.isRemote !== b.isRemote) return a.isRemote ? -1 : 1;
      return keyA.localeCompare(keyB);
    })
    .map(([libraryKey, entry]) => ({
      libraryKey,
      libraryName: entry.libraryName,
      isRemote: entry.isRemote,
      components: Array.from(entry.componentMap.values()).sort((a, b) =>
        a.componentName.localeCompare(b.componentName),
      ),
    }));

  figma.ui.postMessage({ type: "scan-result", libraries });
}

function getDocumentName(component: ComponentNode): string | null {
  // Walk up the parent chain to the root DocumentNode. For remote components,
  // this root belongs to the source library file (not figma.root), so its
  // .name is the exact library file name — no REST API call required.
  let node: BaseNode | null = component;
  while (node.parent !== null) {
    node = node.parent;
  }
  if (node.type === "DOCUMENT" && node !== figma.root) {
    return node.name;
  }
  return null;
}

function deriveLibraryInfo(component: ComponentNode): {
  key: string;
  name: string;
  isRemote: boolean;
} {
  // Primary: get the real library file name by walking up to the source
  // document root. Works for any remote component without any API token.
  const documentName = getDocumentName(component);
  if (documentName) {
    return { key: `remote:${documentName}`, name: documentName, isRemote: true };
  }

  // Fallback: extract the prefix before the first "/" in the component's
  // display name (e.g. "Foundation/Button" → "Foundation").
  const displayName = getComponentDisplayName(component);
  const slashIdx = displayName.indexOf("/");
  if (slashIdx > 0) {
    const prefix = displayName.substring(0, slashIdx).trim();
    return { key: `remote:${prefix}`, name: prefix, isRemote: true };
  }

  return {
    key: "remote",
    name: "Remote",
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
