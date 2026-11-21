// Language toggle, copy buttons and the fog comparison slider. Nothing else.
(function () {
  var root = document.documentElement;
  var KEY = 'dual-vtt-site:lang';
  var copyLabels = { es: ['Copiar', 'Copiado'], en: ['Copy', 'Copied'] };

  var titles = {
    es: 'Dual VTT: mesa virtual gratuita para Daggerheart',
    en: 'Dual VTT: a free virtual tabletop for Daggerheart',
  };

  function setLang(lang) {
    root.lang = lang;
    document.title = titles[lang];
    document.querySelectorAll('[data-alt-' + lang + ']').forEach(function (el) {
      el.alt = el.getAttribute('data-alt-' + lang);
    });
    document.querySelectorAll('[data-aria-' + lang + ']').forEach(function (el) {
      el.setAttribute('aria-label', el.getAttribute('data-aria-' + lang));
    });
    document.querySelectorAll('.copy').forEach(function (btn) {
      btn.textContent = copyLabels[lang][0];
      btn.removeAttribute('data-done');
    });
    try {
      localStorage.setItem(KEY, lang);
    } catch (e) {}
  }

  var saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch (e) {}
  var fromUrl = new URLSearchParams(location.search).get('lang');
  var initial = fromUrl === 'en' || fromUrl === 'es' ? fromUrl : saved === 'en' ? 'en' : 'es';
  if (initial !== 'es') setLang(initial);

  document.getElementById('lang-toggle').addEventListener('click', function () {
    setLang(root.lang === 'es' ? 'en' : 'es');
  });

  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.parentElement.querySelector('code').textContent;
      var labels = copyLabels[root.lang] || copyLabels.es;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = labels[1];
        btn.setAttribute('data-done', '');
        setTimeout(function () {
          btn.textContent = labels[0];
          btn.removeAttribute('data-done');
        }, 1600);
      });
    });
  });

  document.querySelectorAll('.compare').forEach(function (box) {
    var range = box.querySelector('.compare-range');
    range.addEventListener('input', function () {
      box.style.setProperty('--pos', range.value + '%');
    });
  });
})();
