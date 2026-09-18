/** Public native build configuration. Never put server secrets in extra or EXPO_PUBLIC_*. */
module.exports = ({ config }) => {
  const release = ["preview", "production"].includes(process.env.EAS_BUILD_PROFILE);
  const appId = process.env.CREWROOM_APP_ID;
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  if (release) {
    if (!appId || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/.test(appId) || /(^|\.)example\./.test(appId))
      throw new Error("Set CREWROOM_APP_ID to your final reverse-domain app identifier before a signed preview or production build.");
    if (!projectId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId))
      throw new Error("Link your Expo project with eas init, then set EAS_PROJECT_ID to its project UUID.");
    for (const name of ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_WEB_URL"]) {
      let url;
      try { url = new URL(process.env[name]); } catch { throw new Error(`Set ${name} to your hosted HTTPS origin before building.`); }
      const labels = url.hostname.split(".");
      const publicHostname = url.hostname.length <= 253 && labels.length >= 2 &&
        labels.every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) &&
        /^[a-z]/.test(labels.at(-1));
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
          !publicHostname || /(^|\.)(localhost|example\.(com|org|net))$|\.(test|local|localdomain|invalid|example|internal|lan|home|home\.arpa)$/.test(url.hostname))
        throw new Error(`${name} must be a public HTTPS origin, without a path, credentials, or a local/example address.`);
    }
  }
  return {
    ...config,
    ios: { ...config.ios, ...(appId ? { bundleIdentifier: appId } : {}), infoPlist: { ...config.ios?.infoPlist, ITSAppUsesNonExemptEncryption: false } },
    android: { ...config.android, ...(appId ? { package: appId } : {}) },
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
  };
};
