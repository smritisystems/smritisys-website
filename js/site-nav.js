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

  function createCanonicalProductMenu(mobile, currentPath) {
    const menu = document.createElement('details');
    menu.className = 'product-menu';
    const summary = document.createElement('summary');
    summary.className = mobile ? 'product-menu-trigger rounded-lg px-3 py-2' : 'product-menu-trigger';
    summary.textContent = 'Product';
    const panel = document.createElement('div');
    panel.className = `product-menu-panel ${mobile ? 'text-slate-700' : 'text-slate-600'}`;

    productLinks.forEach(([href, label]) => {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      const isCurrentPage = href.startsWith(`${currentPath}#`) || href === currentPath || (href === 'distributor.html' && currentPath === 'distribution.html');
      if (isCurrentPage) {
        link.className = 'text-brand-700 font-semibold';
        summary.classList.add('text-brand-700', 'font-semibold');
      }
      panel.append(link);
    });

    menu.append(summary, panel);
    return menu;
  }

  function normalizePublicNavigation() {
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const createNavLink = (href, label, mobile) => {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      link.className = mobile ? 'rounded-lg px-3 py-2 hover:bg-slate-50' : 'hover:text-brand-700 transition';
      if (href === currentPath || (href === 'index.html' && currentPath === 'index.html')) link.className += ' text-brand-700 font-semibold';
      return link;
    };
    const desktop = document.querySelector('header nav.hidden.lg\\:flex');
    const mobile = document.querySelector('#mobileMenu .grid');
    if (desktop) {
      desktop.replaceChildren();
      desktop.append(createNavLink('index.html', 'Home', false));
      desktop.append(createCanonicalProductMenu(false, currentPath));
      desktop.append(createNavLink('industries.html', 'Industries', false));
      desktop.append(createNavLink('security.html', 'Security', false));
      desktop.append(createNavLink('index.html#contact', 'Contact', false));
    }
    if (mobile) {
      mobile.replaceChildren();
      const links = [
        ['index.html', 'Home'],
        ['industries.html', 'Industries'],
        ['security.html', 'Security'],
        ['index.html#contact', 'Contact'],
        ['portal.html', 'Customer Login'],
      ];
      const homeLink = links.shift();
      mobile.append(createNavLink(homeLink[0], homeLink[1], true));
      mobile.append(createCanonicalProductMenu(true, currentPath));
      links.forEach(([href, label]) => mobile.append(createNavLink(href, label, true)));
    }
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

  function addPolicyAdministrationDetails() {
    const detailsByPage = {
      'privacy-policy.html': 'SMRITI SYSTEMS administers privacy requests at <a href="mailto:smritisys@gmail.com">smritisys@gmail.com</a>. Public enquiries are generally retained for up to 24 months after the last meaningful interaction, subject to legal and business requirements.',
      'terms-and-conditions.html': 'These terms are provided by <strong>SMRITI SYSTEMS</strong>. Subject to applicable law, Indian law applies and courts in Mumbai, Maharashtra are the intended jurisdiction.',
      'cookie-policy.html': 'Cookie and browser-storage questions can be sent to <a href="mailto:smritisys@gmail.com">smritisys@gmail.com</a>. This notice should be revisited whenever deployed website tooling changes.',
      'regulatory-compliance.html': '<strong>SMRITI SYSTEMS</strong> administers this public governance notice. Compliance questions can be sent to <a href="mailto:smritisys@gmail.com">smritisys@gmail.com</a>. Mumbai, Maharashtra is the intended business jurisdiction, subject to applicable law.'
    };
    const currentPath = window.location.pathname.split('/').pop();
    const detail = detailsByPage[currentPath];
    const main = document.querySelector('main');
    if (!detail || !main || main.querySelector('.policy-administration')) return;
    const notice = document.createElement('p');
    notice.className = 'policy-administration';
    notice.innerHTML = `<strong>Policy administration:</strong> ${detail}`;
    main.insertBefore(notice, main.firstElementChild?.nextElementSibling || main.firstChild);
  }

  normalizePublicNavigation();
  normalizeProductSaathiImages();
  moveSecondaryLinksToFooter();
  addLegalLinksToFooter();
  addPolicyAdministrationDetails();
})();
