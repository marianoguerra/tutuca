import { init, scrollToHash } from "./common.js";

const URL_ASSETS = {
  tutuca: "tutuca.min.js",
  "tutuca-extra": "tutuca-extra.min.js",
  "tutuca-dev": "tutuca-dev.min.js",
};

const SIZE_ASSETS = {
  tutuca: "tutuca.min.js.br",
  "tutuca-extra": "tutuca-extra.min.js.br",
  "tutuca-dev": "tutuca-dev.min.js.br",
};

async function fetchLatestRelease() {
  const resp = await fetch(
    "https://api.github.com/repos/marianoguerra/tutuca/releases/latest",
  );
  if (!resp.ok) return null;
  return resp.json();
}

function updateBuildsFromRelease(release) {
  if (!release || !release.assets) return;
  const assetsByName = Object.fromEntries(
    release.assets.map((a) => [a.name, a]),
  );

  for (const el of document.querySelectorAll("[data-release-build]")) {
    const build = el.dataset.releaseBuild;

    const urlAsset = assetsByName[URL_ASSETS[build]];
    if (urlAsset) {
      const link = el.querySelector("[data-release-url]");
      if (link) link.href = urlAsset.browser_download_url;
    }

    const sizeAsset = assetsByName[SIZE_ASSETS[build]];
    if (sizeAsset) {
      const sizeEl = el.querySelector("[data-release-size]");
      if (sizeEl) sizeEl.textContent = `${(sizeAsset.size / 1024).toFixed(1)} KB`;
    }
  }
}

init().then(() => {
  scrollToHash();
  fetchLatestRelease().then(updateBuildsFromRelease);
});
