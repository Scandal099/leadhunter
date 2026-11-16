// Ссылки на страницу организации в 2ГИС, Яндекс Картах и Google Maps.
// Если контору нашли на этой карте — прямая ссылка на её страницу,
// иначе — поиск на этой карте по названию и адресу (обычно сразу открывает нужную карточку).
// Файл общий: подключается на страницах (window.mapLinks) и в Node (require).
(function (root) {
  const MAPS = [
    { src: '2gis', name: '2ГИС' },
    { src: 'yandex', name: 'Яндекс Карты' },
    { src: 'google', name: 'Google Maps' },
  ];

  function mapLinks(l, settings) {
    settings = settings || {};
    const gis = settings.twogisDomain || '2gis.ru';
    const ya = settings.yandexDomain || 'yandex.ru';
    const addr = String(l.address || '');
    // город добавляем, только если его нет в адресе
    const place = [addr, l.city && !addr.toLowerCase().includes(String(l.city).toLowerCase()) ? l.city : ''].filter(Boolean).join(', ');
    const q = encodeURIComponent([l.name, place].filter(Boolean).join(', '));
    const hasPt = l.lat != null && l.lon != null && l.lat !== '' && l.lon !== '';
    const search = {
      '2gis': `https://${gis}/search/${q}` + (hasPt ? `?m=${l.lon},${l.lat}/16` : ''),
      yandex: `https://${ya}/maps/?text=${q}` + (hasPt ? `&ll=${l.lon},${l.lat}&z=16` : ''),
      google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    };
    return MAPS.map((m) => {
      const found = (l.sources || []).find((s) => s.src === m.src && s.url);
      return { src: m.src, name: m.name, url: found ? found.url : search[m.src], direct: !!found };
    });
  }

  /** Лучшая ссылка: прямая страница, если есть, иначе поиск в первой карте */
  function mainMapLink(l, settings) {
    const all = mapLinks(l, settings);
    return all.find((x) => x.direct) || all[0];
  }

  root.mapLinks = mapLinks;
  root.mainMapLink = mainMapLink;
  if (typeof module !== 'undefined' && module.exports) module.exports = { mapLinks, mainMapLink };
})(typeof window !== 'undefined' ? window : globalThis);
