(() => {
  const saathiAssetsByPage = {
    'distributor.html': ['saathi_male_fullbody_hd.png', 'saathi_female_fullbody_hd.png'],
    'warehouse.html': ['saathi_male_fullbody_hd.png', 'saathi_female_fullbody_hd.png'],
    'barcode.html': ['saathi_female_fullbody_hd.png', 'saathi_male_fullbody_hd.png'],
  };

  const productLinks = [
    ['products.html#capabilities', 'Retail POS'],
    ['distributor.html', 'Distributor'],
    ['warehouse.html', 'Warehouse'],
    ['barcode.html', 'Barcode Studio'],
  ];

  const sourcePaths = {
    'products.html': ['products.html'],
    'distributor.html': ['distributor.html', 'distribution.html'],
    'warehouse.html': ['warehouse.html'],
    'barcode.html': ['barcode.html'],
  };

  function linkMatches(link, path) {
    return link.getAttribute('href') === path || link.getAttribute('href') === `${path}#capabilities`;
  }

  function createProductMenu(container, links, mobile) {
    const menu = document.createElement('details');
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    menu.className = 'product-menu';
    const summary = document.createElement('summary');
    summary.className = mobile ? 'product-menu-trigger px-3 py-2' : 'product-menu-trigger';
    summary.textContent = 'Product';
    const panel = document.createElement('div');
    panel.className = `product-menu-panel ${mobile ? 'text-slate-700' : 'text-slate-600'}`;

    productLinks.forEach(([href, label]) => {
      const source = links.find((link) => sourcePaths[href.split('#')[0]].some((path) => linkMatches(link, path)));
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      const isCurrentPage = href.startsWith(`${currentPath}#`) || href === currentPath || (href === 'distributor.html' && currentPath === 'distribution.html');
      if (isCurrentPage || source?.className.includes('text-brand-700')) {
        link.className = 'text-brand-700 font-semibold';
      }
      panel.append(link);
    });

    menu.append(summary, panel);
    const firstLink = links[0];
    container.insertBefore(menu, firstLink);
    links.forEach((link) => link.remove());
  }

  function groupProductLinks(selector, mobile = false) {
    const container = document.querySelector(selector);
    if (!container || container.querySelector('.product-menu')) return;
    const links = [...container.querySelectorAll(':scope > a')];
    const productLinks = links.filter((link) => Object.values(sourcePaths).flat().some((path) => linkMatches(link, path)));
    if (productLinks.length !== 4) return;
    createProductMenu(container, links, mobile);
  }

  function normalizeProductSaathiImages() {
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const assets = saathiAssetsByPage[currentPath];
    if (!assets) return;
    document.querySelectorAll('main img[src*="assets/SmritiSathi/pose_"]').forEach((image, index) => {
      if (assets[index]) image.src = `assets/SmritiSathi/${assets[index]}`;
    });
  }

  function moveSecondaryLinksToFooter() {
    const secondaryPaths = new Set(['presentations.html', 'editions.html']);
    document.querySelectorAll('header nav').forEach((nav) => {
      [...nav.querySelectorAll(':scope > a')].forEach((link) => {
        if (secondaryPaths.has(link.getAttribute('href'))) link.remove();
      });
    });

    const footer = document.querySelector('footer');
    if (!footer || footer.querySelector('a[href="presentations.html"], a[href="editions.html"]')) return;
    const section = document.createElement('section');
    section.className = 'public-footer-links';
    section.innerHTML = '<h2>Product &amp; Editions</h2><nav aria-label="Product and editions"><a href="presentations.html">Presentations</a><a href="editions.html">Editions</a></nav>';
    footer.querySelector(':scope > div')?.append(section);
  }

  function addLegalLinksToFooter() {
    const footer = document.querySelector('footer');
    if (!footer || footer.querySelector('.public-legal-links')) return;
    const section = document.createElement('section');
    section.className = 'public-footer-links public-legal-links';
    section.innerHTML = '<h2>Legal &amp; Compliance</h2><nav aria-label="Legal and compliance"><a href="privacy-policy.html">Privacy Policy</a><a href="terms-and-conditions.html">Terms &amp; Conditions</a><a href="cookie-policy.html">Cookies</a><a href="regulatory-compliance.html">Regulatory Compliance</a></nav>';
    footer.querySelector(':scope > div')?.append(section);
  }

  groupProductLinks('header > div > div > nav.hidden.lg\\:flex');
  groupProductLinks('#mobileMenu .grid', true);
  normalizeProductSaathiImages();
  moveSecondaryLinksToFooter();
  addLegalLinksToFooter();
})();
