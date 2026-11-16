const { mapLinks } = require('../public/maplinks');
// Общие функции для лидов: статусы, CSV, текст первого касания (сервер + Telegram-бот)
const STATUS_RU = { none: 'Нет сайта', social: 'Только соцсети', constructor: 'Конструктор', dead: 'Сайт не работает', weak: 'Слабый сайт', ok: 'Нормальный сайт', unknown: 'Не проверен', pending: 'Проверяется' };
const LEAD_STATUS = { new: 'Новый', base: 'В базе', work: 'В работе', client: 'Клиент', reject: 'Отказ' };
const HOT = new Set(['none', 'social', 'constructor', 'dead', 'weak']);

const siteStatus = (l) => l.site?.status || (l.website ? 'pending' : (l.socials?.length ? 'social' : 'none'));
const score = (l) => l.site?.score ?? (l.website ? 50 : 100);

function problemText(l) {
  const s = siteStatus(l);
  if (s === 'none') return 'Заметил, что у вас нет сайта — клиенты из поиска уходят к конкурентам.';
  if (s === 'social') return 'Вижу, что вместо сайта у вас только соцсети — из поиска Яндекса и Google вас почти не найти.';
  if (s === 'constructor') return `Ваш сайт собран на конструкторе${l.site?.builder ? ' (' + l.site.builder + ')' : ''} — такие сайты плохо продвигаются и выглядят шаблонно.`;
  if (s === 'dead') return 'Ваш сайт сейчас не открывается — клиенты видят ошибку.';
  if (s === 'weak') return 'Ваш сайт выглядит устаревшим и плохо открывается с телефона.';
  return 'Посмотрел ваш сайт — есть что улучшить по заявкам и скорости.';
}

function toCsv(leads, settings) {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['Название', 'Категория', 'Город', 'Адрес', 'Телефоны', 'Сайт', 'Статус сайта', 'Конструктор', 'Причины', 'Соцсети', 'Email', 'Рейтинг', 'Отзывы', '2ГИС', 'Яндекс Карты', 'Google Maps', 'Статус', 'Заметка'];
  const rows = leads.map((l) => [l.name, l.category, l.city, l.address, l.phones.join(', '), l.website, STATUS_RU[l.site?.status] || '', l.site?.builder || '', (l.site?.reasons || []).join('; '), l.socials.join(', '), (l.emails || []).join(', '), l.rating, l.reviews, ...mapLinks(l, settings).map((m) => m.url), l.status, l.note].map(esc).join(';'));
  return '﻿' + [head.map(esc).join(';'), ...rows].join('\r\n');
}

module.exports = { STATUS_RU, LEAD_STATUS, HOT, siteStatus, score, problemText, toCsv };
