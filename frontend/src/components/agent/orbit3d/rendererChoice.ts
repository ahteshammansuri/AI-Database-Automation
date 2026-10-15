/** 3D for the main character sizes when WebGL works; SVG for tiny avatars and as the fallback. */
export function chooseRenderer(size: string, hasWebgl: boolean): "3d" | "svg" {
  return hasWebgl && (size === "md" || size === "lg" || size === "xl") ? "3d" : "svg";
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
