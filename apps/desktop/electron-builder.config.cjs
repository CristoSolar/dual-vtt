// electron-builder configuration for Dual VTT. Run through `pnpm -F
// @daggerheart/desktop dist` (which builds the web app and the main bundle first).
//
// Signing is optional and driven by env vars; when they are absent the build is
// unsigned (Windows SmartScreen / macOS Gatekeeper warn — see the README):
//   Windows: CSC_LINK + CSC_KEY_PASSWORD (or WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD)
//   macOS:   CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application certificate),
//            plus APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID to notarize.
const { version } = require('../../package.json');

const macSigned = Boolean(process.env.CSC_LINK);
const notarize = Boolean(
  macSigned && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID,
);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.cristosolar.dualvtt',
  productName: 'Dual VTT',
  copyright: 'Copyright © Cristobal Solar. Daggerheart SRD content © Critical Role, LLC (DPCGL).',
  // One version for the whole repo: the root package.json's.
  // desktopName ties the running window to its .desktop entry on Linux.
  extraMetadata: { version, name: 'dual-vtt', desktopName: 'dual-vtt.desktop' },
  directories: { output: 'dist', buildResources: 'resources' },
  files: ['out/main.cjs', 'resources/icon.png', 'package.json'],
  // The web app's production build, served by the in-process server.
  extraResources: [{ from: '../web/dist', to: 'web', filter: ['**/*'] }],
  asar: true,
  // Everything is bundled into out/main.cjs; there are no native modules to rebuild.
  npmRebuild: false,
  nodeGypRebuild: false,
  // No version in the name, so the project page can link to
  // releases/latest/download/<file> for every release.
  artifactName: 'Dual-VTT-${os}-${arch}.${ext}',

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.ico',
  },
  nsis: {
    // Per-user: no admin prompt, installs under %LOCALAPPDATA%\Programs.
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Dual VTT',
    // Campaigns live in %APPDATA%\Dual VTT; uninstalling must not take them.
    deleteAppDataOnUninstall: false,
  },

  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'resources/icon.icns',
    category: 'public.app-category.role-playing-games',
    hardenedRuntime: true,
    // Unsigned builds are ad-hoc signed so Apple Silicon will run them at all.
    identity: macSigned ? undefined : '-',
    notarize,
  },
  dmg: { title: 'Dual VTT ${version}' },

  linux: {
    target: ['AppImage', 'deb', 'rpm'],
    icon: 'resources/icons',
    category: 'Game',
    synopsis: 'Self-hosted Daggerheart-compatible virtual tabletop',
    maintainer: 'Cristobal Solar <cristosolar@users.noreply.github.com>',
    executableName: 'dual-vtt',
    syncDesktopName: true,
  },
};
