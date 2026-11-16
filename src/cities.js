// Слаги городов для 2ГИС (2gis.ru/<slug>/search/...)
const MAP = {
  'москва': 'moscow', 'санкт-петербург': 'spb', 'питер': 'spb', 'спб': 'spb', 'новосибирск': 'novosibirsk',
  'екатеринбург': 'ekaterinburg', 'казань': 'kazan', 'нижний новгород': 'n_novgorod', 'челябинск': 'chelyabinsk',
  'самара': 'samara', 'омск': 'omsk', 'ростов-на-дону': 'rostov', 'ростов': 'rostov', 'уфа': 'ufa',
  'красноярск': 'krasnoyarsk', 'воронеж': 'voronezh', 'пермь': 'perm', 'волгоград': 'volgograd',
  'краснодар': 'krasnodar', 'саратов': 'saratov', 'тюмень': 'tyumen', 'тольятти': 'tolyatti', 'ижевск': 'izhevsk',
  'барнаул': 'barnaul', 'ульяновск': 'ulyanovsk', 'иркутск': 'irkutsk', 'хабаровск': 'khabarovsk',
  'ярославль': 'yaroslavl', 'владивосток': 'vladivostok', 'махачкала': 'makhachkala', 'томск': 'tomsk',
  'оренбург': 'orenburg', 'кемерово': 'kemerovo', 'новокузнецк': 'novokuznetsk', 'рязань': 'ryazan',
  'набережные челны': 'nabchelny', 'астрахань': 'astrakhan', 'пенза': 'penza', 'липецк': 'lipetsk',
  'киров': 'kirov', 'тула': 'tula', 'чебоксары': 'cheboksary', 'калининград': 'kaliningrad', 'курск': 'kursk',
  'сочи': 'sochi', 'ставрополь': 'stavropol', 'белгород': 'belgorod', 'сургут': 'surgut', 'владимир': 'vladimir',
  'архангельск': 'arkhangelsk', 'смоленск': 'smolensk', 'калуга': 'kaluga', 'брянск': 'bryansk', 'иваново': 'ivanovo',
  'магнитогорск': 'magnitogorsk', 'тверь': 'tver', 'нижний тагил': 'ntagil', 'якутск': 'yakutsk', 'чита': 'chita',
  'улан-удэ': 'ulanude', 'вологда': 'vologda', 'мурманск': 'murmansk', 'курган': 'kurgan', 'орёл': 'orel', 'орел': 'orel',
  'севастополь': 'sevastopol', 'симферополь': 'simferopol', 'грозный': 'grozny', 'минск': 'minsk',
  'алматы': 'almaty', 'астана': 'astana', 'бишкек': 'bishkek', 'ташкент': 'tashkent', 'дубай': 'dubai',
};

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ' ': '_', '-': '_' };

function citySlug(city) {
  const c = String(city || '').toLowerCase().trim();
  if (!c) return '';
  if (MAP[c]) return MAP[c];
  if (/^[a-z_]+$/.test(c)) return c;
  return [...c].map((ch) => (ch in TR ? TR[ch] : /[a-z0-9]/.test(ch) ? ch : '')).join('');
}

module.exports = { citySlug };
