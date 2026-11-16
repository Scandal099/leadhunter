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

function toMarkdown(leads, settings, title = 'Выгрузка лидов для нейросети') {
  const lines = [
    `# ${title}`,
    `Дата: ${new Date().toISOString().slice(0, 10)} · Всего компаний: ${leads.length}`,
    '',
    '## Инструкция для нейросети',
    'Открой указанные ссылки по каждой компании (сайт, соцсети, карты 2ГИС/Яндекс/Google, Rusprofile, VK) и собери структурированную карточку:',
    '1. Чем именно занимается компания, основные услуги и примерный прайс.',
    '2. Найденный ЛПР / владелец / директор (имя, должность, личные контакты/соцсети).',
    '3. Что не так с текущим сайтом или упаковкой в соцсетях (почему им нужен новый сайт).',
    '4. Персонализированное сообщение для первого касания под конкретную компанию.',
    '',
    '---',
    '',
  ];
  leads.forEach((l, idx) => {
    const s = siteStatus(l);
    const maps = mapLinks(l, settings);
    const qName = encodeURIComponent(`${l.name} ${l.city || ''}`.trim());
    const msg = (settings?.messageTemplate || '').replace('{name}', l.name).replace('{problem}', problemText(l));
    lines.push(`## ${idx + 1}. ${l.name}`);
    lines.push(`- **ID:** \`${l.id}\``);
    lines.push(`- **Статус в воронке:** ${LEAD_STATUS[l.status] || l.status}`);
    if (l.niche || l.category) lines.push(`- **Ниша / категория:** ${[l.niche, l.category].filter(Boolean).join(' · ')}`);
    if (l.city || l.address) lines.push(`- **Локация:** ${[l.city, l.address].filter(Boolean).join(', ')}`);
    if (l.rating) lines.push(`- **Рейтинг:** ${l.rating}${l.reviews ? ` (${l.reviews} отзывов)` : ''}`);
    if (l.phones?.length) lines.push(`- **Телефоны:** ${l.phones.join(', ')}`);
    lines.push(`- **Сайт:** ${l.website || 'нет'} (${STATUS_RU[s] || s}${l.site?.builder ? `, конструктор: ${l.site.builder}` : ''})`);
    if (l.site?.reasons?.length) lines.push(`- **Проблемы сайта:** ${l.site.reasons.join('; ')}`);
    if (l.socials?.length) lines.push(`- **Соцсети:** ${l.socials.join(', ')}`);
    if (l.emails?.length) lines.push(`- **Email:** ${l.emails.join(', ')}`);
    if (l.contactPerson) lines.push(`- **Контактное лицо:** ${l.contactPerson}`);
    if (l.note) lines.push(`- **Заметка:** ${l.note}`);
    lines.push(`- **Карты:** ${maps.map((m) => `[${m.name}${m.direct ? ' (прямая)' : ''}](${m.url})`).join(' | ')}`);
    lines.push(`- **Поиск ЛПР:** [Google](https://www.google.com/search?q=${qName}+владелец+OR+директор) | [Яндекс](https://yandex.ru/search/?text=${qName}+директор) | [Rusprofile](https://www.rusprofile.ru/search?query=${encodeURIComponent(l.name)}) | [VK](https://vk.com/search?c%5Bq%5D=${encodeURIComponent(l.name)}&c%5Bsection%5D=communities)`);
    if (msg) lines.push(`- **Шаблон первого касания:** ${msg}`);
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = { STATUS_RU, LEAD_STATUS, HOT, siteStatus, score, problemText, toCsv, toMarkdown };
