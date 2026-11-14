import * as THREE from 'three';

/* =====================================================================
   MOON MISSION — Level 1: Ancient Fire Moon
   Third-person: walk out of the lab, drive the rover across a huge
   cratered map, collect rock samples, bring them back to the lab.
   ===================================================================== */

// ----------------------------------------------------------------- constants
const GOAL = 12;            // samples to deliver
const CAP_FOOT = 4;         // backpack capacity
const START_MONEY = 100;   // $ at the start of the mission
const REWARD = 150;        // $ paid for every sample stored in the lab
const HEAL_COST = 3;       // $ per health point restored at the lab
const REPAIR_COST = 1.2;   // $ per % of rover health repaired at the lab
const JUMP_G = 5.0;        // stylised low gravity (m/s^2)
const JUMP_FOOT = 4.7;     // astronaut take-off speed
const JUMP_CAR = 5.0;      // rover take-off speed
const JUMP_G_CAR = 9.0;    // the heavy rover falls faster than the astronaut
const CAP_CARGO = 12;       // rover capacity
const CS = 192;             // terrain chunk size (m)
const RING = 8;             // chunks loaded around the player (view ~1.5 km)
const NEAR = 2;             // high-detail ring
const WORLD = 5000;         // half-size of the playable map (10 km x 10 km)
const DOOR = { x: 0, z: 19 };
const LAB_RADIUS = 30;
// solid parts of the base (ground plan): circles [x, z, r] and boxes [x0, z0, x1, z1]
const LAB_CIRCLES = [[0, 0, 10.9], [20, 18, 2.3], [-14, 22, 0.6], [8, 22, 0.4]];
for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; LAB_CIRCLES.push([Math.sin(a) * 27, Math.cos(a) * 27, 0.35]); }   // lamp posts
const LAB_BOXES = [
  [10.5, -3.4, 25.8, 3.4], [-25.8, -3.4, -10.5, 3.4], [-3.4, -25.8, 3.4, -10.5],   // side modules + tubes
  [-3.3, 9.7, 3.3, 17.0],                                                           // airlock
  [31, -13, 45, 13],                                                                // solar farm
  [-9.4, 18.2, -6.8, 21.8]                                                          // cargo crates
];
// deepest contact of a circle (px, pz, rad) with the base, or null
function labContact(px, pz, rad) {
  if (px * px + pz * pz > 60 * 60) return null;
  let best = null;
  for (const [cx, cz, r] of LAB_CIRCLES) {
    const dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz), pen = r + rad - d;
    if (pen > 0 && (!best || pen > best.pen)) best = d > 1e-4 ? { nx: dx / d, nz: dz / d, pen } : { nx: 1, nz: 0, pen };
  }
  for (const [x0, z0, x1, z1] of LAB_BOXES) {
    const qx = Math.max(x0, Math.min(x1, px)), qz = Math.max(z0, Math.min(z1, pz)), dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
    let c = null;
    if (d > 1e-4) { if (d < rad) c = { nx: dx / d, nz: dz / d, pen: rad - d }; }
    else {                                    // centre is inside the box: leave through the nearest face
      const e = [[px - x0, -1, 0], [x1 - px, 1, 0], [pz - z0, 0, -1], [z1 - pz, 0, 1]].sort((a, b) => a[0] - b[0])[0];
      c = { nx: e[1], nz: e[2], pen: e[0] + rad };
    }
    if (c && (!best || c.pen > best.pen)) best = c;
  }
  return best;
}
const SUN = new THREE.Vector3(0.82, 0.34, 0.5).normalize();

// ----------------------------------------------------------------- strings
const T = {
  en: {
    health: 'Health', oxygen: 'Oxygen', energy: 'Energy', radiation: 'Radiation', rover: 'Rover',
    delivered: 'Samples delivered', carrying: 'Backpack', cargo: 'Rover cargo', kmh: 'km/h',
    st_ok: 'Safe', st_fatigue: 'Fatigue', st_illness: 'Radiation sickness', st_injury: 'Radiation injury',
    obj_getRover: 'Walk to the rover and get in', obj_drive: 'Drive to the glowing crater',
    obj_collect: 'Collect the glowing rock samples', obj_load: 'Load the samples into the rover',
    obj_return: 'Drive back to the lab', obj_store: 'Store the samples in the lab',
    obj_walkRover: 'Return to the rover', obj_exitLab: 'Walk out of the lab',
    tgt_lab: 'Lab', tgt_rover: 'Rover', tgt_rock: 'Sample',
    p_enter: 'Press E — get into the rover', p_exit: 'Press E — get out of the rover',
    p_collect: 'Press E — collect rock sample', p_load: 'Press E — load samples into the rover',
    p_store: 'Press E — store samples in the lab',
    a_collect: 'Collecting sample…', a_load: 'Loading the rover…', a_store: 'Storing samples in the lab…',
    w_flareSoon: 'Solar flare in {s} s — get to shelter!',
    w_flare: 'SOLAR FLARE — radiation x3.5! Reach the lab or hide in a crater.',
    w_o2: 'Low oxygen! Return to the lab.', w_en: 'Energy empty — the rover crawls slowly!',
    w_edge: 'You are leaving the mapped area. Turn back.', w_rad: 'High radiation! Get to the lab.',
    m_refill: 'Lab: oxygen and energy are being restored',
    m_repair: 'Lab: the rover is being repaired',
    money: 'Money', f_broke: 'Not enough money!', f_earn: '+${m} — samples delivered',
    s_heal: 'Press <kbd>H</kbd> — heal to full ({c})', s_healing: 'Healing… press <kbd>H</kbd> to stop',
    s_repair: 'Press <kbd>R</kbd> — repair the rover ({c})', s_repairing: 'Repairing the rover… press <kbd>R</kbd> to stop',
    w_hit: 'Collision! Rover −{d}%', w_rv1: 'Rover badly damaged — avoid the stones, repair it at the lab.', w_rv0: 'Rover wrecked — it can only crawl. Repair it at the lab.',
    v_first: 'FIRST-PERSON VIEW', v_third: 'THIRD-PERSON VIEW',
    helpTitle: 'MOON MISSION',
    help: ['W / S — walk or drive forward / back', 'A / D — turn left / right',
      'Space — jump · Shift — run · B — brake', 'E — interact (rover, rocks, lab)',
      'C — switch 3rd / 1st person view', 'H — heal · R — repair rover (at the lab, costs money)', 'Drag the mouse — look around · Wheel — zoom', 'Esc — pause'],
    helpGoal: 'Drive to the glowing craters, collect rock samples, load them into the rover and store 12 samples in the lab. The sun’s radiation hurts you outside, and oxygen and energy run down — return to the lab to recover. Stones damage the rover. Samples earn money — spend it at the lab to heal yourself (H) and repair the rover (R).',
    begin: 'BEGIN MISSION', loading: 'Generating the Moon…',
    paused: 'PAUSED', resume: 'RESUME', quit: 'BACK TO LEVELS',
    winT: 'Discovery complete!', winD: '{d} You delivered {n} samples in {t}.',
    loseT: 'Mission failed', lose_rad: 'Radiation sickness took the astronaut.', lose_o2: 'The astronaut ran out of oxygen.',
    again: 'PLAY AGAIN', site: 'Crater', lab: 'LAB'
  },
  uz: {
    health: 'Salomatlik', oxygen: 'Kislorod', energy: 'Energiya', radiation: 'Radiatsiya', rover: 'Rover',
    delivered: 'Yetkazilgan namunalar', carrying: 'Ryukzak', cargo: 'Rover yuki', kmh: 'km/soat',
    st_ok: 'Xavfsiz', st_fatigue: 'Charchoq', st_illness: 'Nur kasalligi', st_injury: 'Radiatsion jarohat',
    obj_getRover: 'Roverga borib, unga o‘tiring', obj_drive: 'Yonib turgan krater tomon yuring',
    obj_collect: 'Yonib turgan tosh namunalarini yig‘ing', obj_load: 'Namunalarni roverga yuklang',
    obj_return: 'Laboratoriyaga qayting', obj_store: 'Namunalarni laboratoriyaga qo‘ying',
    obj_walkRover: 'Roverga qayting', obj_exitLab: 'Laboratoriyadan chiqing',
    tgt_lab: 'Laboratoriya', tgt_rover: 'Rover', tgt_rock: 'Namuna',
    p_enter: 'E bosing — roverga o‘tirish', p_exit: 'E bosing — roverdan tushish',
    p_collect: 'E bosing — tosh namunasini olish', p_load: 'E bosing — namunalarni roverga yuklash',
    p_store: 'E bosing — namunalarni laboratoriyaga qo‘yish',
    a_collect: 'Namuna olinmoqda…', a_load: 'Rover yuklanmoqda…', a_store: 'Namunalar laboratoriyaga qo‘yilmoqda…',
    w_flareSoon: 'Quyosh alangasi {s} soniyada — panoh toping!',
    w_flare: 'QUYOSH ALANGASI — radiatsiya 3,5 baravar! Laboratoriyaga yoki kraterga yashiring.',
    w_o2: 'Kislorod kam! Laboratoriyaga qayting.', w_en: 'Energiya tugadi — rover sekin yuradi!',
    w_edge: 'Xarita chegarasidan chiqyapsiz. Orqaga qayting.', w_rad: 'Radiatsiya yuqori! Laboratoriyaga boring.',
    m_refill: 'Laboratoriya: kislorod va energiya tiklanmoqda',
    m_repair: 'Laboratoriya: rover ta’mirlanmoqda',
    money: 'Pul', f_broke: 'Pul yetarli emas!', f_earn: '+${m} — namunalar topshirildi',
    s_heal: '<kbd>H</kbd> bosing — to‘liq davolanish ({c})', s_healing: 'Davolanmoqda… to‘xtatish uchun <kbd>H</kbd>',
    s_repair: '<kbd>R</kbd> bosing — roverni ta’mirlash ({c})', s_repairing: 'Rover ta’mirlanmoqda… to‘xtatish uchun <kbd>R</kbd>',
    w_hit: 'To‘qnashuv! Rover −{d}%', w_rv1: 'Rover qattiq shikastlandi — toshlardan qoching, laboratoriyada ta’mirlang.', w_rv0: 'Rover ishdan chiqdi — faqat sekin yura oladi. Laboratoriyada ta’mirlang.',
    v_first: 'BIRINCHI SHAXS KO‘RINISHI', v_third: 'UCHINCHI SHAXS KO‘RINISHI',
    helpTitle: 'OY MISSIYASI',
    help: ['W / S — oldinga / orqaga yurish yoki haydash', 'A / D — chapga / o‘ngga burilish',
      'Space — sakrash · Shift — yugurish · B — tormoz', 'E — o‘zaro ta’sir (rover, toshlar, laboratoriya)',
      'C — ko‘rinish: 3-shaxs / 1-shaxs', 'H — davolanish · R — rover ta’miri (laboratoriyada, pul kerak)', 'Sichqonchani sudrang — atrofga qarash · G‘ildirak — yaqinlashtirish', 'Esc — pauza'],
    helpGoal: 'Yonib turgan kraterlarga boring, tosh namunalarini yig‘ing, roverga yuklang va laboratoriyaga 12 ta namuna yetkazing. Tashqarida quyosh radiatsiyasi zarar qiladi, kislorod va energiya kamayadi — tiklanish uchun laboratoriyaga qayting. Toshlar roverga zarar yetkazadi. Namunalar pul keltiradi — uni laboratoriyada davolanish (H) va roverni ta’mirlash (R) uchun sarflang.',
    begin: 'MISSIYANI BOSHLASH', loading: 'Oy yaratilmoqda…',
    paused: 'PAUZA', resume: 'DAVOM ETISH', quit: 'BOSQICHLARGA QAYTISH',
    winT: 'Kashfiyot yakunlandi!', winD: '{d} Siz {t} ichida {n} ta namuna yetkazdingiz.',
    loseT: 'Missiya muvaffaqiyatsiz', lose_rad: 'Nur kasalligi kosmonavtni olib ketdi.', lose_o2: 'Kosmonavtning kislorodi tugadi.',
    again: 'QAYTA O‘YNASH', site: 'Krater', lab: 'LAB'
  },
  ru: {
    health: 'Здоровье', oxygen: 'Кислород', energy: 'Энергия', radiation: 'Радиация', rover: 'Ровер',
    delivered: 'Доставлено образцов', carrying: 'Рюкзак', cargo: 'Груз ровера', kmh: 'км/ч',
    st_ok: 'Безопасно', st_fatigue: 'Усталость', st_illness: 'Лучевая болезнь', st_injury: 'Лучевая травма',
    obj_getRover: 'Подойдите к роверу и сядьте в него', obj_drive: 'Езжайте к светящемуся кратеру',
    obj_collect: 'Соберите светящиеся образцы породы', obj_load: 'Погрузите образцы в ровер',
    obj_return: 'Возвращайтесь в лабораторию', obj_store: 'Сдайте образцы в лабораторию',
    obj_walkRover: 'Вернитесь к роверу', obj_exitLab: 'Выйдите из лаборатории',
    tgt_lab: 'Лаборатория', tgt_rover: 'Ровер', tgt_rock: 'Образец',
    p_enter: 'Нажмите E — сесть в ровер', p_exit: 'Нажмите E — выйти из ровера',
    p_collect: 'Нажмите E — взять образец', p_load: 'Нажмите E — погрузить образцы в ровер',
    p_store: 'Нажмите E — сдать образцы в лабораторию',
    a_collect: 'Сбор образца…', a_load: 'Погрузка в ровер…', a_store: 'Образцы убираются в лабораторию…',
    w_flareSoon: 'Солнечная вспышка через {s} с — найдите укрытие!',
    w_flare: 'СОЛНЕЧНАЯ ВСПЫШКА — радиация x3,5! Спрячьтесь в лаборатории или в кратере.',
    w_o2: 'Мало кислорода! Вернитесь в лабораторию.', w_en: 'Энергия закончилась — ровер едва ползёт!',
    w_edge: 'Вы покидаете карту. Поверните назад.', w_rad: 'Высокая радиация! Идите в лабораторию.',
    m_refill: 'Лаборатория: восстанавливаются кислород и энергия',
    m_repair: 'Лаборатория: ровер ремонтируется',
    money: 'Деньги', f_broke: 'Недостаточно денег!', f_earn: '+${m} — образцы сданы',
    s_heal: 'Нажмите <kbd>H</kbd> — полностью вылечиться ({c})', s_healing: 'Лечение… нажмите <kbd>H</kbd>, чтобы остановить',
    s_repair: 'Нажмите <kbd>R</kbd> — починить ровер ({c})', s_repairing: 'Ремонт ровера… нажмите <kbd>R</kbd>, чтобы остановить',
    w_hit: 'Столкновение! Ровер −{d}%', w_rv1: 'Ровер сильно повреждён — объезжайте камни, почините его в лаборатории.', w_rv0: 'Ровер разбит — он может лишь ползти. Почините его в лаборатории.',
    v_first: 'ВИД ОТ ПЕРВОГО ЛИЦА', v_third: 'ВИД ОТ ТРЕТЬЕГО ЛИЦА',
    helpTitle: 'ЛУННАЯ МИССИЯ',
    help: ['W / S — идти или ехать вперёд / назад', 'A / D — поворот влево / вправо',
      'Пробел — прыжок · Shift — бег · B — тормоз', 'E — действие (ровер, камни, лаборатория)',
      'C — вид от 3-го / 1-го лица', 'H — лечение · R — ремонт ровера (в лаборатории, за деньги)', 'Перетаскивайте мышь — осмотр · Колесо — масштаб', 'Esc — пауза'],
    helpGoal: 'Езжайте к светящимся кратерам, собирайте образцы породы, грузите их в ровер и сдайте 12 образцов в лабораторию. Снаружи солнечная радиация вредит здоровью, а кислород и энергия убывают — для восстановления возвращайтесь в лабораторию. Камни повреждают ровер. Образцы приносят деньги — тратьте их в лаборатории на лечение (H) и ремонт ровера (R).',
    begin: 'НАЧАТЬ МИССИЮ', loading: 'Создаём Луну…',
    paused: 'ПАУЗА', resume: 'ПРОДОЛЖИТЬ', quit: 'К УРОВНЯМ',
    winT: 'Открытие совершено!', winD: '{d} Вы доставили образцов: {n}, время: {t}.',
    loseT: 'Миссия провалена', lose_rad: 'Лучевая болезнь погубила астронавта.', lose_o2: 'У астронавта закончился кислород.',
    again: 'ИГРАТЬ СНОВА', site: 'Кратер', lab: 'ЛАБ'
  }
};
const SITE_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];

// ----------------------------------------------------------------- math/noise
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function hash(ix, iz, s) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul((s | 0) + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, s), b = hash(ix + 1, iz, s), c = hash(ix, iz + 1, s), d = hash(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ----------------------------------------------------------------- world
const SITE_DEF = [[650, 0.9], [1100, 2.5], [1700, 4.1], [2400, 5.4], [3300, 1.6]];
const SITES = SITE_DEF.map(([d, a], i) => ({
  id: i, name: SITE_NAMES[i], x: Math.sin(a) * d, z: Math.cos(a) * d,
  R: 85 + hash(i, 7, 3) * 30, D: 14 + hash(i, 8, 3) * 6, left: 0
}));
const LAYERS = [
  { cell: 900, rmin: 110, rmax: 260, p: 0.55, s: 11, dk: 0.11 },
  { cell: 300, rmin: 30, rmax: 75, p: 0.6, s: 12, dk: 0.13 },
  { cell: 110, rmin: 9, rmax: 22, p: 0.65, s: 13, dk: 0.16 }
];
function craterH(dx, dz, R, D) {
  const t = Math.sqrt(dx * dx + dz * dz) / R;
  if (t > 2.3) return 0;
  let h = t < 1 ? -D * (1 - t * t) : 0;
  const q = (t - 1) / 0.28;
  return h + D * 0.28 * Math.exp(-q * q);
}
function heightAt(x, z) {
  let h = (vnoise(x * 0.0016, z * 0.0016, 1) - 0.5) * 36
        + (vnoise(x * 0.0045, z * 0.0045, 2) - 0.5) * 12
        + (vnoise(x * 0.012, z * 0.012, 3) - 0.5) * 4.5
        + (vnoise(x * 0.04, z * 0.04, 4) - 0.5) * 1.1;
  for (let l = 0; l < 3; l++) {
    const L = LAYERS[l];
    const cx0 = Math.floor(x / L.cell), cz0 = Math.floor(z / L.cell);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = cx0 + i, cz = cz0 + j;
      if (hash(cx, cz, L.s) > L.p) continue;
      const px = (cx + hash(cx, cz, L.s + 20)) * L.cell, pz = (cz + hash(cx, cz, L.s + 40)) * L.cell;
      const R = L.rmin + hash(cx, cz, L.s + 60) * (L.rmax - L.rmin);
      h += craterH(x - px, z - pz, R, R * (L.dk + 0.05 * hash(cx, cz, L.s + 80)));
    }
  }
  for (let k = 0; k < SITES.length; k++) {
    const s = SITES[k];
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz < (s.R * 2.4) * (s.R * 2.4)) h += craterH(dx, dz, s.R, s.D);
  }
  // flat building area around the lab
  const d = Math.sqrt(x * x + z * z);
  if (d < 140) h *= smooth(60, 140, d);
  return h;
}

// ----------------------------------------------------------------- textures
function makeDetailTexture() {
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
  const octs = [[8, 0.35], [16, 0.25], [32, 0.2], [64, 0.12], [128, 0.08]];
  const grids = octs.map(([s]) => { const g = new Float32Array(s * s); for (let i = 0; i < g.length; i++) g[i] = Math.random(); return g; });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (let o = 0; o < octs.length; o++) {
      const s = octs[o][0], g = grids[o];
      const fx = x / N * s, fy = y / N * s, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy, x1 = (ix + 1) % s, y1 = (iy + 1) % s;
      const a = g[iy * s + ix], b = g[iy * s + x1], cc = g[y1 * s + ix], d = g[y1 * s + x1];
      v += octs[o][1] * (a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty);
    }
    const k = Math.floor(clamp(150 + v * 105, 0, 255)), p = (y * N + x) * 4;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = k; img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function makeEarthTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1b5fb8'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#2f8f4e';
  for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(Math.random() * 512, 30 + Math.random() * 196, 14 + Math.random() * 46, 8 + Math.random() * 26, Math.random() * 3, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 256, 20 + Math.random() * 60, 4 + Math.random() * 10, Math.random() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ----------------------------------------------------------------- terrain chunks
function buildTerrainGeometry(cx, cz, n) {
  const step = CS / n, x0 = cx * CS, z0 = cz * CS, m = n + 3;
  const H = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) H[j * m + i] = heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const gv = (n + 1) * (n + 1), V = gv + 4 * (n + 1), SK = 14;
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3), uv = new Float32Array(V * 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = j * (n + 1) + i, h = H[(j + 1) * m + i + 1], x = i * step, z = j * step;
    const hl = H[(j + 1) * m + i], hr = H[(j + 1) * m + i + 2], hu = H[j * m + i + 1], hd = H[(j + 2) * m + i + 1];
    const nx = hl - hr, ny = 2 * step, nz = hu - hd, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
    const wx = x0 + x, wz = z0 + z;
    let g = 0.15 + 0.08 * vnoise(wx * 0.004, wz * 0.004, 21) + 0.045 * vnoise(wx * 0.03, wz * 0.03, 22);
    g *= 0.78 + 0.22 * (ny / l);
    col[k * 3] = g * 1.02; col[k * 3 + 1] = g * 0.99; col[k * 3 + 2] = g * 0.95;
    uv[k * 2] = wx / 7; uv[k * 2 + 1] = wz / 7;
  }
  const edges = [];
  for (let i = 0; i <= n; i++) edges.push(i);                   // top  j=0
  for (let i = 0; i <= n; i++) edges.push(n * (n + 1) + i);     // bottom j=n
  for (let j = 0; j <= n; j++) edges.push(j * (n + 1));         // left i=0
  for (let j = 0; j <= n; j++) edges.push(j * (n + 1) + n);     // right i=n
  for (let e = 0; e < edges.length; e++) {
    const src = edges[e], dst = gv + e;
    pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - SK; pos[dst * 3 + 2] = pos[src * 3 + 2];
    nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
    col[dst * 3] = col[src * 3]; col[dst * 3 + 1] = col[src * 3 + 1]; col[dst * 3 + 2] = col[src * 3 + 2];
    uv[dst * 2] = uv[src * 2]; uv[dst * 2 + 1] = uv[src * 2 + 1];
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  for (let side = 0; side < 4; side++) for (let i = 0; i < n; i++) {
    const e0 = side * (n + 1) + i, e1 = e0 + 1;
    idx.push(edges[e0], gv + e0, edges[e1], edges[e1], gv + e0, gv + e1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// ----------------------------------------------------------------- models
const M = {};
function initMaterials() {
  M.white = new THREE.MeshStandardMaterial({ color: 0xe4eaf2, roughness: 0.5, metalness: 0.25 });
  M.grey = new THREE.MeshStandardMaterial({ color: 0x8e98a6, roughness: 0.6, metalness: 0.4 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.7, metalness: 0.3 });
  M.orange = new THREE.MeshStandardMaterial({ color: 0xff7a2f, roughness: 0.5, metalness: 0.2 });
  M.solar = new THREE.MeshStandardMaterial({ color: 0x1d3f86, roughness: 0.25, metalness: 0.7 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x9fd6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false });
  M.visor = new THREE.MeshStandardMaterial({ color: 0xffc66b, roughness: 0.08, metalness: 0.9 });
  M.win = new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd98a, emissiveIntensity: 1.2 });
  M.tire = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.95, metalness: 0 });
  M.rock = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 1, flatShading: true });
  M.sample = new THREE.MeshStandardMaterial({ color: 0x2a8f9a, emissive: 0x39e6ff, emissiveIntensity: 1.1, roughness: 0.4, flatShading: true });
}
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true; return m;
}

function makeAstronaut() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const torso = mesh(new THREE.BoxGeometry(0.56, 0.62, 0.34), M.white, 0, 1.12, 0);
  const pack = mesh(new THREE.BoxGeometry(0.46, 0.58, 0.24), M.grey, 0, 1.15, -0.28);
  const helmet = mesh(new THREE.SphereGeometry(0.27, 20, 14), M.white, 0, 1.64, 0.02);
  const visor = mesh(new THREE.SphereGeometry(0.2, 16, 12), M.visor, 0, 1.65, 0.1);
  visor.scale.set(1, 0.8, 0.9);
  const belt = mesh(new THREE.BoxGeometry(0.58, 0.1, 0.36), M.orange, 0, 0.82, 0);
  body.add(torso, pack, helmet, visor, belt);
  const limb = (x, y, len, r, mat, cy) => {
    const g = new THREE.Group(); g.position.set(x, y, 0);
    const m = mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat, 0, cy === undefined ? -len / 2 - r * 0.4 : cy, 0);
    g.add(m); return g;
  };
  const armL = limb(0.38, 1.36, 0.42, 0.1, M.white), armR = limb(-0.38, 1.36, 0.42, 0.1, M.white);
  const legL = limb(0.16, 0.8, 0.54, 0.13, M.white, -0.4), legR = limb(-0.16, 0.8, 0.54, 0.13, M.white, -0.4);   // soles at y = 0
  body.add(armL, armR, legL, legR);
  return { root, body, armL, armR, legL, legR };
}

function makeRover() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  body.add(mesh(new THREE.BoxGeometry(2.7, 0.55, 5.6), M.white, 0, 1.0, 0));
  body.add(mesh(new THREE.BoxGeometry(2.74, 0.12, 5.64), M.orange, 0, 0.76, 0));
  const hood = mesh(new THREE.BoxGeometry(2.3, 0.7, 1.6), M.grey, 0, 1.55, 2.0); body.add(hood);   // hood
  const cabin = mesh(new THREE.BoxGeometry(2.3, 1.15, 2.1), M.glass, 0, 1.88, 0.35, false);
  body.add(cabin);
  [[-1.15, 0.35, 1.0], [1.15, 0.35, 1.0], [-1.15, 0.35, -0.68], [1.15, 0.35, -0.68]].forEach(([x, z]) => {
    body.add(mesh(new THREE.BoxGeometry(0.07, 1.2, 0.07), M.dark, x, 1.9, z));
  });
  body.add(mesh(new THREE.BoxGeometry(2.4, 0.07, 2.2), M.dark, 0, 2.5, 0.35));
  const seat = new THREE.Group(); seat.position.set(0, 0.55, 0.25); body.add(seat);
  const eye = new THREE.Object3D(); eye.position.set(0, 2.28, 0.25); body.add(eye);   // driver's eyes (first-person view)
  body.add(mesh(new THREE.BoxGeometry(0.7, 0.12, 0.6), M.dark, 0, 1.28, 0.2));
  body.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.12), M.dark, 0, 1.6, -0.15));
  // cargo bed
  body.add(mesh(new THREE.BoxGeometry(2.5, 0.14, 2.3), M.grey, 0, 1.34, -1.85));
  [[-1.2, -1.85, 0.12, 2.3], [1.2, -1.85, 0.12, 2.3]].forEach(([x, z, w, l]) => body.add(mesh(new THREE.BoxGeometry(w, 0.5, l), M.grey, x, 1.55, z)));
  body.add(mesh(new THREE.BoxGeometry(2.5, 0.5, 0.12), M.grey, 0, 1.55, -3.0));
  // solar panel + antenna
  const panel = mesh(new THREE.BoxGeometry(2.0, 0.06, 1.5), M.solar, 0, 2.75, 0.35); body.add(panel);
  body.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), M.dark, -0.9, 3.0, -1.0));
  body.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), M.orange, -0.9, 3.65, -1.0));
  // lights
  [-0.95, 0.95].forEach(x => body.add(mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), M.win, x, 1.1, 2.82, false)));
  const spot = new THREE.SpotLight(0xfff2d8, 900, 160, 0.5, 0.6, 1.6);
  spot.position.set(0, 1.3, 2.7); spot.target.position.set(0, 0.2, 40);
  body.add(spot); body.add(spot.target);
  // wheels
  const wheels = [];
  const wg = new THREE.CylinderGeometry(0.72, 0.72, 0.55, 20); wg.rotateZ(Math.PI / 2);
  [[-1.6, 2.0], [1.6, 2.0], [-1.6, 0.0], [1.6, 0.0], [-1.6, -2.0], [1.6, -2.0]].forEach(([x, z]) => {
    const w = new THREE.Group(); w.position.set(x, 0.72, z);
    const t = mesh(wg, M.tire); const hub = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.58, 10).rotateZ(Math.PI / 2), M.grey);
    w.add(t, hub); body.add(w); wheels.push(w);
  });
  // cargo rocks
  const cargoRocks = [];
  const rg = new THREE.DodecahedronGeometry(0.3, 0);
  for (let i = 0; i < CAP_CARGO; i++) {
    const r = mesh(rg, M.sample, -0.7 + (i % 3) * 0.7, 1.55 + Math.floor(i / 9) * 0.3, -2.45 + Math.floor((i % 9) / 3) * 0.7);
    r.rotation.set(i, i * 2, i * 3); r.visible = false; body.add(r); cargoRocks.push(r);
  }
  return { root, body, seat, eye, hood, wheels, cargoRocks, spot };
}

function makeLab() {
  const g = new THREE.Group();
  const dome = mesh(new THREE.SphereGeometry(10, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), M.white, 0, 1.2, 0);
  g.add(dome);
  g.add(mesh(new THREE.CylinderGeometry(10.4, 10.8, 1.4, 36), M.grey, 0, 0.7, 0));
  // windows ring
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const w = mesh(new THREE.BoxGeometry(1.3, 0.8, 0.25), M.win, Math.sin(a) * 9.6, 4.2, Math.cos(a) * 9.6, false);
    w.rotation.y = a; g.add(w);
  }
  // modules
  [[-1, 0], [1, 0], [0, -1]].forEach(([dx, dz], i) => {
    const mod = mesh(new THREE.CylinderGeometry(3.4, 3.4, 11, 20), M.white, 0, 0, 0);
    mod.rotation.z = Math.PI / 2; mod.rotation.y = dz ? Math.PI / 2 : 0;
    mod.position.set(dx * 17, 3.5, dz * 17); g.add(mod);
    const cap = mesh(new THREE.SphereGeometry(3.4, 16, 10), M.white, dx * 22.4, 3.5, dz * 22.4); g.add(cap);
    const tube = mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 12), M.grey, dx * 11.5, 2.6, dz * 11.5);
    tube.rotation.z = Math.PI / 2; tube.rotation.y = dz ? Math.PI / 2 : 0; g.add(tube);
    const stripe = mesh(new THREE.CylinderGeometry(3.45, 3.45, 1.2, 20), M.orange, dx * 17, 3.5, dz * 17);
    stripe.rotation.z = Math.PI / 2; stripe.rotation.y = dz ? Math.PI / 2 : 0; g.add(stripe);
  });
  // airlock
  g.add(mesh(new THREE.BoxGeometry(6.4, 4.6, 7), M.white, 0, 2.3, 13.2));
  g.add(mesh(new THREE.BoxGeometry(6.6, 0.4, 7.2), M.orange, 0, 4.7, 13.2));
  const door = mesh(new THREE.BoxGeometry(3.0, 3.6, 0.25), M.dark, 0, 1.9, 16.8);
  g.add(door);
  g.add(mesh(new THREE.BoxGeometry(3.4, 0.3, 0.5), M.win, 0, 4.05, 16.9, false));
  // solar farm
  for (let r = 0; r < 2; r++) for (let i = -2; i <= 2; i++) {
    const p = mesh(new THREE.BoxGeometry(6, 0.18, 3.4), M.solar, 34 + r * 7, 2.2, i * 5.2);
    p.rotation.z = -0.55; g.add(p);
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.2, 6), M.grey, 34 + r * 7, 1.1, i * 5.2));
  }
  // dish antenna
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.4, 9, 8), M.grey, -14, 4.5, 22));
  const dish = mesh(new THREE.SphereGeometry(3, 18, 8, 0, Math.PI * 2, 0, 0.9), M.white, -14, 9.5, 22);
  dish.rotation.set(-0.9, 0.4, 0); g.add(dish);
  // tank
  g.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 6, 16), M.white, 20, 3, 18));
  g.add(mesh(new THREE.CylinderGeometry(2.25, 2.25, 0.8, 16), M.orange, 20, 4.2, 18));
  // landing-pad lights
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), M.win, Math.sin(a) * LAB_RADIUS, 0.25, Math.cos(a) * LAB_RADIUS, false));
  }
  // ---- base upgrade: landing pad, ribbed dome, lamp posts, flag, sign, crates
  const pad = mesh(new THREE.CylinderGeometry(27, 27, 0.06, 64), M.dark, 0, 0.03, 0, false); pad.receiveShadow = true; g.add(pad);
  [[26.2, 0.5], [19, 0.3], [12.4, 0.3]].forEach(([r, w]) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 64), new THREE.MeshBasicMaterial({ color: 0xff7a2f, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.075; g.add(m);
  });
  [0.55, 1.05].forEach(a => {                                    // ribs around the dome
    const rr = 10 * Math.sin(a) + 0.05, rib = mesh(new THREE.TorusGeometry(rr, 0.13, 8, 48), M.orange, 0, 1.2 + 10 * Math.cos(a), 0, false);
    rib.rotation.x = Math.PI / 2; g.add(rib);
  });
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 5, 8), M.grey, 0, 13.6, 0));                // roof mast
  g.add(mesh(new THREE.SphereGeometry(0.35, 12, 8), M.orange, 0, 16.3, 0, false));
  for (let i = 0; i < 8; i++) {                                  // lamp posts
    const a = (i + 0.5) / 8 * Math.PI * 2, x = Math.sin(a) * 27, z = Math.cos(a) * 27;
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.16, 5, 8), M.grey, x, 2.5, z));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), M.win, x, 5.1, z, false));
  }
  // flag (an invented one: blue field with an orange moon)
  { const c = document.createElement('canvas'); c.width = 128; c.height = 80; const x = c.getContext('2d');
    x.fillStyle = '#12264f'; x.fillRect(0, 0, 128, 80); x.fillStyle = '#ff7a2f'; x.beginPath(); x.arc(64, 40, 24, 0, 7); x.fill();
    x.fillStyle = '#12264f'; x.beginPath(); x.arc(74, 34, 20, 0, 7); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 8), M.grey, 8, 4.5, 22));
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    fl.position.set(9.7, 7.9, 22); g.add(fl);
    g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), M.orange, 8, 9.1, 22, false)); }
  // sign on the airlock roof
  { const c = document.createElement('canvas'); c.width = 512; c.height = 96; const x = c.getContext('2d');
    x.fillStyle = '#0c1628'; x.fillRect(0, 0, 512, 96); x.strokeStyle = '#ff7a2f'; x.lineWidth = 6; x.strokeRect(4, 4, 504, 88);
    x.fillStyle = '#9fe9ff'; x.font = '700 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('MOON BASE', 256, 52);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    g.add(mesh(new THREE.BoxGeometry(6.2, 1.2, 0.2), M.dark, 0, 5.6, 15.6));
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(5.9, 1.1), new THREE.MeshBasicMaterial({ map: t }));
    sg.position.set(0, 5.6, 15.71); g.add(sg); }
  // cargo crates
  [[-8.6, 19.0, 1.5, M.orange], [-7.7, 21.0, 1.5, M.grey], [-8.2, 20.0, 1.2, M.grey]].forEach(([x, z, sz, m], i) => {
    const cr = mesh(new THREE.BoxGeometry(sz, sz, sz), m, x, sz / 2 + (i === 2 ? 1.5 : 0), z); cr.rotation.y = i * 0.5; g.add(cr);
  });

  // refill zone ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(LAB_RADIUS - 0.5, LAB_RADIUS + 0.5, 64),
    new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; g.add(ring);
  // beacon
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 160, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x55dfff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  beam.position.y = 80; g.add(beam);
  return { group: g, door };
}

// ----------------------------------------------------------------- audio
class Sfx {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ok = !!AC; if (!this.ok) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.vol = 0.7; this.master.gain.value = this.vol * 0.35;
    this.eng = this.ctx.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 45;
    this.engF = this.ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 220;
    this.engG = this.ctx.createGain(); this.engG.gain.value = 0;
    this.eng.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master); this.eng.start();
  }
  setVolume(v) { if (this.ok) { this.vol = v; this.master.gain.value = v * 0.35; } }
  drive(speedFrac, on) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.eng.frequency.setTargetAtTime(38 + speedFrac * 70, t, 0.1);
    this.engF.frequency.setTargetAtTime(160 + speedFrac * 340, t, 0.1);
    this.engG.gain.setTargetAtTime(on ? 0.05 + speedFrac * 0.1 : 0, t, 0.15);
  }
  beep(f, d = 0.12, type = 'sine', g = 0.25, delay = 0) {
    if (!this.ok || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), gn = this.ctx.createGain();
    o.type = type; o.frequency.value = f; gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(gn); gn.connect(this.master); o.start(t); o.stop(t + d + 0.02);
  }
  chime() { this.beep(660, 0.15, 'triangle'); this.beep(880, 0.2, 'triangle', 0.25, 0.1); this.beep(1320, 0.3, 'triangle', 0.2, 0.2); }
  crash() { this.beep(70, 0.28, 'square', 0.3); this.beep(140, 0.2, 'sawtooth', 0.22, 0.02); this.beep(900, 0.08, 'square', 0.1, 0.01); }
  pick() { this.beep(520, 0.1, 'square', 0.12); this.beep(780, 0.14, 'square', 0.12, 0.08); }
  alarm() { this.beep(440, 0.18, 'sawtooth', 0.18); this.beep(330, 0.18, 'sawtooth', 0.18, 0.2); }
  resume() { if (this.ok && this.ctx.state === 'suspended') this.ctx.resume(); }
  close() { if (this.ok) { try { this.eng.stop(); this.ctx.close(); } catch (e) { /* ignore */ } } }
}

// ----------------------------------------------------------------- HUD / DOM
const CSS = `
.mg-root{position:absolute;inset:0;overflow:hidden;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#eef4ff;user-select:none;-webkit-user-select:none;background:#000}
.mg-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.mg-canvas.drag{cursor:grabbing}
.mg-glass{background:linear-gradient(160deg,rgba(26,44,80,.66),rgba(8,15,32,.78));border:1px solid rgba(160,200,255,.18);border-radius:16px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 16px 40px rgba(0,0,0,.35)}
.mg-vig{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(255,60,40,0) 45%,rgba(255,50,30,.55) 100%);transition:opacity .3s}
.mg-hurt{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(255,0,0,0) 40%,rgba(255,0,0,.5) 100%)}
.mg-stats{position:absolute;left:18px;top:18px;width:250px;padding:14px 16px}
.mg-row{margin-bottom:11px}.mg-row:last-child{margin-bottom:0}
.mg-rh{display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;margin-bottom:5px;letter-spacing:.02em}
.mg-rv{font-variant-numeric:tabular-nums;color:var(--c)}
.mg-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.mg-bar span{display:block;height:100%;width:100%;border-radius:99px;background:var(--c);transition:width .15s linear}
.mg-row.low .mg-bar span{animation:mgblink .6s infinite}
@keyframes mgblink{50%{opacity:.35}}
.mg-obj{position:absolute;left:50%;top:18px;transform:translateX(-50%);padding:11px 20px;text-align:center;min-width:300px;max-width:min(520px,max(260px,calc(100vw - 600px)))}
.mg-obj b{display:block;font-size:14px;letter-spacing:.04em}
.mg-obj small{display:block;margin-top:4px;color:#8ea4c2;font-size:12px;letter-spacing:.06em}
.mg-prog{height:5px;border-radius:99px;background:rgba(255,255,255,.12);margin-top:8px;overflow:hidden}
.mg-prog span{display:block;height:100%;width:0;background:linear-gradient(90deg,#4fb8e6,#7fe3ff);border-radius:99px;transition:width .3s}
.mg-map{position:absolute;right:18px;top:18px;padding:10px;width:208px}
.mg-map canvas{display:block;width:186px;height:186px;border-radius:50%}
.mg-map .mg-sp{margin-top:8px;text-align:center;font-size:12px;color:#8ea4c2;letter-spacing:.08em}
.mg-map .mg-sp b{color:#eef4ff;font-size:15px}
.mg-tgt{position:absolute;right:18px;top:274px;width:208px;padding:10px 14px;display:flex;align-items:center;gap:12px;font-size:12.5px}
.mg-arrow{width:30px;height:30px;flex:0 0 30px}
.mg-tgt b{display:block;font-size:13.5px}.mg-tgt span{color:#8ea4c2}
.mg-inv{position:absolute;left:18px;top:256px;padding:10px 16px;font-size:12.5px;line-height:1.7;width:250px}
.mg-inv b{color:#7fe3ff;float:right;font-variant-numeric:tabular-nums}
.mg-svc{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);padding:10px 20px;font-size:14px;font-weight:600;display:none;text-align:center;line-height:1.7}
.mg-svc kbd{display:inline-block;padding:1px 8px;margin:0 2px;border-radius:6px;background:#ffd877;color:#1b1400;font-weight:800}
.mg-prompt{position:absolute;left:50%;bottom:90px;transform:translateX(-50%);padding:12px 22px;font-size:15px;font-weight:600;letter-spacing:.03em;display:none;white-space:nowrap}
.mg-prompt kbd{display:inline-block;padding:1px 8px;margin:0 2px;border-radius:6px;background:#7fe3ff;color:#06121f;font-weight:800}
.mg-action{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);padding:12px 22px;min-width:280px;text-align:center;display:none}
.mg-action .mg-prog{margin-top:8px;height:6px}
.mg-warn{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);padding:10px 20px;font-size:14px;font-weight:700;color:#ffd877;border-color:rgba(255,216,119,.5);display:none;max-width:min(720px,92vw);text-align:center}
.mg-warn.red{color:#ff9d8a;border-color:rgba(255,120,100,.6)}
.mg-msg{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);padding:9px 18px;font-size:13px;color:#9af3c2;display:none}
.mg-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 0 1px rgba(0,0,0,.45);display:none;pointer-events:none}
.mg-view{position:absolute;left:50%;top:104px;transform:translateX(-50%);padding:8px 18px;font-size:13px;font-weight:700;letter-spacing:.08em;color:#cfeaff;opacity:0;transition:opacity .35s;pointer-events:none}
.mg-pause{position:absolute;left:18px;bottom:18px;padding:9px 16px;font-size:12px;font-weight:700;letter-spacing:.14em;color:#eef4ff;cursor:pointer;border:1px solid rgba(160,200,255,.25);font-family:inherit}
.mg-pause:hover{border-color:#7fe3ff}
.mg-ov{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(2,6,16,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.mg-card{width:min(100%,520px);padding:34px 34px 28px;text-align:center;border-radius:22px;max-height:calc(100vh - 40px);overflow:auto}
.mg-card h2{margin:0 0 12px;font-size:24px;letter-spacing:.1em}
.mg-card p{margin:0 0 16px;font-size:14px;line-height:1.65;color:#bed0e4}
.mg-card ul{list-style:none;margin:0 0 18px;padding:0;text-align:left}
.mg-card li{padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.07);font-size:14px;color:#dbe7f7}
.mg-btn{display:block;width:100%;min-height:50px;margin:10px 0 0;border-radius:14px;border:1px solid rgba(179,215,255,.25);background:rgba(14,28,54,.65);color:#eef5ff;font:inherit;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:transform .3s cubic-bezier(.2,.8,.2,1),border-color .2s,background .2s}
.mg-btn:hover{transform:translateY(-2px);border-color:rgba(145,230,255,.6)}
.mg-btn.pri{border-color:transparent;color:#041626;background:linear-gradient(110deg,#9aeaff,#5cc4ec 55%,#4aa9dc)}
.mg-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#02050d;font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:#7fe3ff}
@media (max-width:900px){.mg-obj{top:auto;bottom:150px;max-width:90vw}.mg-stats{width:200px}.mg-inv{display:none}}
`;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

// ----------------------------------------------------------------- the game
let G = null; // running instance

function start(opts) {
  if (G) stop();
  G = createGame(opts);
}
function stop() {
  if (!G) return;
  G.destroy(); G = null;
}

function createGame(opts) {
  const container = opts.container;
  let lang = opts.lang || 'en';
  const tr = (k, v) => { let s = T[lang][k]; if (v) for (const key in v) s = s.replace('{' + key + '}', v[key]); return s; };
  let destroyed = false, raf = 0;

  // ---------- DOM
  container.innerHTML = '';
  const style = el('style'); style.textContent = CSS; container.appendChild(style);
  const root = el('div', 'mg-root'); container.appendChild(root);
  const canvas = el('canvas', 'mg-canvas'); root.appendChild(canvas);
  const vig = el('div', 'mg-vig'), hurt = el('div', 'mg-hurt'); root.append(vig, hurt);
  const stats = el('div', 'mg-stats mg-glass'); root.appendChild(stats);
  const BARS = [['health', '#6ee7a0'], ['oxygen', '#7fe3ff'], ['energy', '#ffb54d'], ['rover', '#b69cff'], ['radiation', '#ff6f6f']];
  const bar = {};
  BARS.forEach(([k, c]) => {
    const r = el('div', 'mg-row'); r.style.setProperty('--c', c);
    r.innerHTML = '<div class="mg-rh"><span class="n"></span><span class="mg-rv v"></span></div><div class="mg-bar"><span></span></div>';
    stats.appendChild(r); bar[k] = { row: r, n: r.querySelector('.n'), v: r.querySelector('.v'), f: r.querySelector('.mg-bar span') };
  });
  const inv = el('div', 'mg-inv mg-glass'); root.appendChild(inv);
  const obj = el('div', 'mg-obj mg-glass', '<b></b><small></small><div class="mg-prog"><span></span></div>'); root.appendChild(obj);
  const objB = obj.querySelector('b'), objS = obj.querySelector('small'), objP = obj.querySelector('.mg-prog span');
  const map = el('div', 'mg-map mg-glass', '<canvas width="372" height="372"></canvas><div class="mg-sp"><b>0</b> <span></span></div>'); root.appendChild(map);
  const mapC = map.querySelector('canvas'), mctx = mapC.getContext('2d'), spB = map.querySelector('b'), spU = map.querySelector('.mg-sp span');
  const tgt = el('div', 'mg-tgt mg-glass',
    '<svg class="mg-arrow" viewBox="0 0 30 30"><path d="M15 3 L24 25 L15 20 L6 25 Z" fill="#7fe3ff"/></svg><div><b></b><span></span></div>');
  root.appendChild(tgt);
  const arrow = tgt.querySelector('.mg-arrow'), tgtB = tgt.querySelector('b'), tgtS = tgt.querySelector('span');
  const prompt = el('div', 'mg-prompt mg-glass'); root.appendChild(prompt);
  const svc = el('div', 'mg-svc mg-glass'); root.appendChild(svc);
  const action = el('div', 'mg-action mg-glass', '<div class="t"></div><div class="mg-prog"><span></span></div>'); root.appendChild(action);
  const actT = action.querySelector('.t'), actP = action.querySelector('.mg-prog span');
  const warn = el('div', 'mg-warn mg-glass'); root.appendChild(warn);
  const msg = el('div', 'mg-msg mg-glass'); root.appendChild(msg);
  const cross = el('div', 'mg-cross'); root.appendChild(cross);
  const viewTag = el('div', 'mg-view mg-glass'); root.appendChild(viewTag);
  const pauseBtn = el('button', 'mg-pause mg-glass', 'II'); pauseBtn.type = 'button'; root.appendChild(pauseBtn);
  const ovHelp = el('div', 'mg-ov'), ovPause = el('div', 'mg-ov'), ovEnd = el('div', 'mg-ov');
  root.append(ovHelp, ovPause, ovEnd);
  const load = el('div', 'mg-load', ''); root.appendChild(load);

  function applyDom() {
    BARS.forEach(([k]) => { bar[k].n.textContent = tr(k); });
    pauseBtn.title = tr('paused');
    ovHelp.innerHTML = '<div class="mg-card mg-glass"><h2>' + tr('helpTitle') + '</h2><p>' + tr('helpGoal') + '</p><ul>' +
      T[lang].help.map(h => '<li>' + h + '</li>').join('') + '</ul><button class="mg-btn pri" type="button">' + tr('begin') + '</button></div>';
    ovHelp.querySelector('button').onclick = () => { ovHelp.style.display = 'none'; sfx.resume(); S.paused = false; };
    ovPause.innerHTML = '<div class="mg-card mg-glass"><h2>' + tr('paused') + '</h2><button class="mg-btn pri" id="r" type="button">' + tr('resume') +
      '</button><button class="mg-btn" id="q" type="button">' + tr('quit') + '</button></div>';
    ovPause.querySelector('#r').onclick = () => setPause(false);
    ovPause.querySelector('#q').onclick = exit;
    load.textContent = tr('loading');
  }

  // ---------- three.js
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x03050a, 650, 1650);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.4, 9000);

  const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sunLight.castShadow = true; sunLight.shadow.mapSize.set(2048, 2048);
  const sc = sunLight.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 420;
  sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.35;
  scene.add(sunLight, sunLight.target);
  scene.add(new THREE.HemisphereLight(0x5a7ab8, 0x2a2a30, 1.0));
  scene.add(new THREE.AmbientLight(0x303a50, 0.7));
  const fill = new THREE.DirectionalLight(0x9db8ff, 0.9); fill.position.set(-SUN.x * 100, 60, -SUN.z * 100); scene.add(fill);

  initMaterials();
  const detailTex = makeDetailTexture();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTex, bumpMap: detailTex, bumpScale: 2.2, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  { const p = rockGeo.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.78 + 0.44 * hash(Math.round(p.getX(i) * 50), Math.round(p.getY(i) * 50), Math.round(p.getZ(i) * 50) + 13); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); } rockGeo.computeVertexNormals(); }

  // sky
  const starGeo = new THREE.BufferGeometry(), sp = new Float32Array(2600 * 3);
  for (let i = 0; i < 2600; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    sp[i * 3] = Math.cos(a) * r * 6000; sp[i * 3 + 1] = Math.abs(u) * 6000; sp[i * 3 + 2] = Math.sin(a) * r * 6000;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false }));
  stars.frustumCulled = false; scene.add(stars);
  const earthTex = makeEarthTexture();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(330, 40, 24), new THREE.MeshBasicMaterial({ map: earthTex, fog: false }));
  earth.position.set(-3300, 2200, -4300); scene.add(earth);
  const sunTex = makeGlowTexture('rgba(255,255,240,1)', 'rgba(255,236,190,.35)');
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
  sunSpr.scale.set(1100, 1100, 1); sunSpr.position.copy(SUN).multiplyScalar(5600); scene.add(sunSpr);

  // lab + rover + astronaut
  const lab = makeLab(); scene.add(lab.group);
  const rover = makeRover(); scene.add(rover.root);
  const astro = makeAstronaut(); scene.add(astro.root);
  const haloTex = makeGlowTexture('rgba(120,240,255,.9)', 'rgba(60,200,240,.25)');

  // sample sites
  const rocks = [];
  SITES.forEach(s => {
    s.left = 4; s.beam = null;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 420, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x55dfff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    beam.position.set(s.x, heightAt(s.x, s.z) + 200, s.z); scene.add(beam); s.beam = beam;
    for (let i = 0; i < 4; i++) {
      const a = hash(s.id, i, 41) * Math.PI * 2, r = s.R * (0.18 + hash(s.id, i, 42) * 0.4);
      const x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r, y = heightAt(x, z);
      const m = mesh(new THREE.DodecahedronGeometry(0.5 + hash(s.id, i, 43) * 0.3, 0), M.sample, x, y + 0.3, z);
      m.rotation.set(i, i * 1.7, i * 2.3);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      halo.scale.set(7, 7, 1); halo.position.set(x, y + 1.0, z);
      scene.add(m, halo);
      rocks.push({ site: s, x, z, y, mesh: m, halo, taken: false });
    }
  });

  // ---------- terrain streaming
  const chunks = new Map();
  let queue = [];
  function chunkKey(cx, cz) { return cx + ',' + cz; }
  // deterministic stone layout per chunk (used both for drawing and for rover collisions)
  const rockCache = new Map();
  function chunkRocks(cx, cz) {
    const key = chunkKey(cx, cz); let a = rockCache.get(key); if (a) return a;
    a = [];
    for (let k = 0; k < 34; k++) {
      const lx = hash(cx * 97 + k, cz, 51) * CS, lz = hash(cx * 97 + k, cz, 52) * CS, wx = cx * CS + lx, wz = cz * CS + lz;
      if (Math.hypot(wx, wz) < 70) continue;
      const big = hash(cx * 97 + k, cz, 53), sc = big > 0.93 ? 1.8 + big * 2 : 0.25 + big * 0.9;
      const sx = sc * (0.8 + hash(k, cx, 57)), sz = sc * (0.8 + hash(k, cz, 58));
      a.push({ lx, lz, wx, wz, y: heightAt(wx, wz) + sc * 0.15, s: sc, sx, sy: sc * 0.8, sz,
        rx: hash(k, cx, 54) * 6, ry: hash(k, cz, 55) * 6, rz: hash(cz, k, 56) * 6, r: 0.75 * (sx + sz) / 2, top: sc * 0.77 });
    }
    rockCache.set(key, a); return a;
  }
  function makeChunk(cx, cz, lod) {
    const geo = buildTerrainGeometry(cx, cz, lod === 0 ? 48 : 12);
    const m = new THREE.Mesh(geo, terrainMat);
    m.position.set(cx * CS, 0, cz * CS); m.receiveShadow = true; m.castShadow = lod === 0;
    let rocksMesh = null;
    if (lod === 0) {
      const cnt = 34; rocksMesh = new THREE.InstancedMesh(rockGeo, M.rock, cnt);
      const o = new THREE.Object3D(); let used = 0;
      for (const r of chunkRocks(cx, cz)) {
        o.position.set(r.lx, r.y, r.lz); o.rotation.set(r.rx, r.ry, r.rz); o.scale.set(r.sx, r.sy, r.sz);
        o.updateMatrix(); rocksMesh.setMatrixAt(used++, o.matrix);
      }
      rocksMesh.count = used; rocksMesh.castShadow = true; rocksMesh.receiveShadow = true; rocksMesh.frustumCulled = false;
      m.add(rocksMesh);
    }
    scene.add(m);
    return { mesh: m, lod, rocks: rocksMesh };
  }
  function removeChunk(c) {
    scene.remove(c.mesh); c.mesh.geometry.dispose(); if (c.rocks) c.rocks.dispose();
  }
  function planChunks(px, pz, immediate) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const want = new Map();
    for (let dz = -RING; dz <= RING; dz++) for (let dx = -RING; dx <= RING; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dz)); if (ring > RING) continue;
      want.set(chunkKey(pcx + dx, pcz + dz), { cx: pcx + dx, cz: pcz + dz, lod: ring <= NEAR ? 0 : 1, d: dx * dx + dz * dz });
    }
    for (const [k, c] of chunks) if (!want.has(k)) { removeChunk(c); chunks.delete(k); }
    for (const k of rockCache.keys()) if (!want.has(k)) rockCache.delete(k);
    queue = [];
    for (const [k, w] of want) { const c = chunks.get(k); if (!c || c.lod !== w.lod) queue.push({ k, w }); }
    queue.sort((a, b) => a.w.d - b.w.d);
    if (immediate) processQueue(1e9);
  }
  function processQueue(budgetMs) {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < budgetMs) {
      const { k, w } = queue.shift();
      const old = chunks.get(k); if (old) removeChunk(old);
      chunks.set(k, makeChunk(w.cx, w.cz, w.lod));
    }
  }

  // ---------- state
  const sfx = new Sfx(); sfx.setVolume(opts.volume == null ? 0.7 : opts.volume);

  // ---------- dust puffs (jump / landing)
  const dustGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const dust = [];
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: 0xb9aca2, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    m.visible = false; scene.add(m); dust.push({ m, t: 0, life: 1, vx: 0, vy: 0, vz: 0, s: 1 });
  }
  let dustI = 0;
  function puff(x, y, z, n, power, color, rise) {
    for (let i = 0; i < n; i++) {
      const d = dust[dustI++ % dust.length], a = Math.random() * Math.PI * 2, sp = (0.5 + Math.random()) * power;
      d.t = 0; d.life = 0.7 + Math.random() * 0.5; d.s = 0.35 + Math.random() * 0.4; d.m.material.color.setHex(color || 0xb9aca2);
      d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = (rise || 0) + 0.4 + Math.random() * 0.9 * power * 0.4;
      d.m.position.set(x + Math.cos(a) * 0.4, y + 0.1, z + Math.sin(a) * 0.4); d.m.visible = true;
    }
  }
  function updateDust(dt) {
    for (const d of dust) {
      if (!d.m.visible) continue;
      d.t += dt; const k = d.t / d.life;
      if (k >= 1) { d.m.visible = false; continue; }
      d.m.position.x += d.vx * dt; d.m.position.z += d.vz * dt; d.m.position.y += d.vy * dt; d.vy -= 1.2 * dt; d.vx *= 0.97; d.vz *= 0.97;
      d.m.scale.setScalar(d.s * (1 + k * 2.2)); d.m.material.opacity = 0.5 * (1 - k) * (1 - k);
    }
  }
  const S = {
    paused: true, over: false, t: 0, mode: 'foot',
    foot: { x: DOOR.x, z: DOOR.z + 5, yaw: 0, speed: 0, phase: 0, y: 0, h: 0, vh: 0, air: false, landT: 0 },
    car: { x: 24, z: 40, yaw: 0.5, v: 0, steer: 0, y: 0, pitch: 0, roll: 0, h: 0, vh: 0, air: false },
    hp: 100, o2: 100, en: 100, rv: 100, money: START_MONEY, svc: { heal: false, repair: false }, svcT: 0, hitT: 0, hitUntil: 0, lastDmg: 0, shake: 0, smokeT: 0, rad: 0, carried: 0, cargo: 0, delivered: 0,
    action: null, flare: { next: 70, warn: false, on: false, t: 0 }, shade: false, shadeT: 0, hurtT: 0,
    view: 'third', viewUntil: 0, inBase: true, autoFP: false,
    cam: { yaw: 0, yawOff: 0, pitchOff: 0, fpPitch: 0, zoom: 1, idle: 0, x: 0, y: 3, z: -8 },
    lastBeepO2: 0, lastRefill: false, doorOpen: 0, toast: 0
  };
  S.car.y = heightAt(S.car.x, S.car.z);
  const keys = {};
  const subject = () => (S.mode === 'car' ? S.car : S.foot);

  // ---------- helpers
  function toast(text, secs) { msg.textContent = text; msg.style.display = 'block'; S.toast = secs || 3; }
  function setPause(p) {
    if (S.over || ovHelp.style.display === 'flex') return;
    S.paused = p; ovPause.style.display = p ? 'flex' : 'none';
  }
  function exit() { const cb = opts.onExit; stop(); if (cb) cb(); }

  function nearestRock(x, z) {
    let best = null, bd = 1e9;
    for (const r of rocks) { if (r.taken) continue; const d = Math.hypot(r.x - x, r.z - z); if (d < bd) { bd = d; best = r; } }
    return best ? { r: best, d: bd } : null;
  }
  function distTo(a, x, z) { return Math.hypot(a.x - x, a.z - z); }

  // ---------- input
  const onKeyDown = e => {
    if (e.repeat && e.code !== 'Space') return;
    const k = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    keys[k] = true;
    if (k === 'Escape') { if (!S.over) setPause(!S.paused); return; }
    if (k === 'KeyP') { setPause(!S.paused); return; }
    if (k === 'KeyE' && !S.paused && !S.over) interact();
    if (k === 'Space' && !e.repeat) jump();
    if (k === 'KeyC' && !e.repeat && !S.paused && !S.over) toggleView();
    if (k === 'KeyH' && !e.repeat) toggleService('heal');
    if (k === 'KeyR' && !e.repeat) toggleService('repair');
  };
  const onKeyUp = e => { keys[e.code] = false; };
  let dragging = false, lx = 0, ly = 0;
  const onDown = e => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.classList.add('drag'); try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } };
  const onMove = e => {
    if (!dragging) return;
    if (S.view === 'first') {
      const dx = (e.clientX - lx) * 0.006;
      if (S.mode === 'foot') S.foot.yaw -= dx; else S.cam.yawOff = clamp(S.cam.yawOff - dx, -2.2, 2.2);
      S.cam.fpPitch = clamp(S.cam.fpPitch - (e.clientY - ly) * 0.004, -1.2, 1.2);
    } else {
      S.cam.yawOff -= (e.clientX - lx) * 0.006; S.cam.pitchOff = clamp(S.cam.pitchOff + (e.clientY - ly) * 0.004, -0.25, 0.9);
    }
    S.cam.idle = 0; lx = e.clientX; ly = e.clientY;
  };
  const onUp = () => { dragging = false; canvas.classList.remove('drag'); };
  const onWheel = e => { e.preventDefault(); if (S.view === 'first') return; S.cam.zoom = clamp(S.cam.zoom * (1 + Math.sign(e.deltaY) * 0.1), 0.55, 2.4); };
  const onResize = () => {
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const onBlur = () => { for (const k in keys) keys[k] = false; if (!S.over && ovHelp.style.display !== 'flex') setPause(true); };
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize); window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  pauseBtn.addEventListener('click', () => setPause(true));

  function flash(text) { viewTag.textContent = text; S.viewUntil = performance.now() + 1900; }
  // paid services at the lab: H heals the astronaut, R repairs the rover
  function toggleService(kind) {
    if (S.paused || S.over) return;
    if (kind === 'heal') {
      if (!S.inLab || S.hp >= 99.5) return;
      if (S.money < 1) { flash(tr('f_broke')); return; }
      S.svc.heal = !S.svc.heal;
    } else {
      if (Math.hypot(S.car.x, S.car.z) >= LAB_RADIUS || S.rv >= 99.5) return;
      if (S.money < 1) { flash(tr('f_broke')); return; }
      S.svc.repair = !S.svc.repair;
    }
    sfx.beep(S.svc[kind] ? 640 : 420, 0.08, 'sine', 0.1);
  }

  // ---------- camera view (C)
  function setView(v) {
    if (S.view === v) return;
    S.view = v;
    const fp = v === 'first';
    camera.fov = fp ? 74 : 62; camera.near = fp ? 0.12 : 0.4; camera.updateProjectionMatrix();
    S.cam.yawOff = 0; S.cam.fpPitch = 0; S.cam.idle = 0;
    flash(tr(fp ? 'v_first' : 'v_third'));
    sfx.beep(fp ? 700 : 520, 0.07, 'sine', 0.08);
  }
  function toggleView() { S.autoFP = false; setView(S.view === 'third' ? 'first' : 'third'); }

  // ---------- stones: the rover takes damage when it hits them
  function roverHit(nx, nz, pen, px, pz, top, fx, fz) {
    const c = S.car;
    c.x += nx * pen; c.z += nz * pen;
    const into = Math.max(0, -(c.v * (fx * nx + fz * nz))), frac = into / (Math.abs(c.v) + 0.001);
    if (into > 2.5 && S.hitT <= 0) {
      const dmg = Math.max(1, Math.min(45, (into - 2) * 0.9 * (0.8 + top * 0.5)));
      S.rv = Math.max(0, S.rv - dmg); S.lastDmg = Math.round(dmg); S.hitUntil = performance.now() + 2200; S.hitT = 0.6;
      S.shake = Math.min(1.6, 0.4 + dmg / 14); S.hurtT = Math.max(S.hurtT, 0.12);
      sfx.crash(); puff(px - nx * 0.5, c.y + c.h + 0.8, pz - nz * 0.5, 10, 2.6);
      c.v *= 1 - 1.2 * frac;                              // bounce back
    } else c.v *= 1 - 0.5 * frac;
  }
  function collideRover(dt) {
    const c = S.car; S.hitT -= dt;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), ccx = Math.floor(c.x / CS), ccz = Math.floor(c.z / CS);
    for (const off of [1.6, -1.6]) {                       // the base is solid
      const hit = labContact(c.x + fx * off, c.z + fz * off, 1.75);
      if (hit) roverHit(hit.nx, hit.nz, hit.pen, c.x + fx * off, c.z + fz * off, 3, fx, fz);
    }
    if (Math.hypot(c.x, c.z) < 80) return;
    for (const off of [1.6, -1.6]) {
      const px = c.x + fx * off, pz = c.z + fz * off;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const r of chunkRocks(ccx + dx, ccz + dz)) {
        if (r.s < 0.6) continue;                              // pebbles are harmless
        const ddx = px - r.wx, ddz = pz - r.wz;
        if (Math.abs(ddx) > 7 || Math.abs(ddz) > 7) continue;
        if (c.h + 0.35 > r.top) continue;                      // hopped over it
        const rad = 1.75 + r.r, d2 = ddx * ddx + ddz * ddz;
        if (d2 >= rad * rad) continue;
        const d = Math.sqrt(d2) || 0.01;
        roverHit(ddx / d, ddz / d, rad - d, px, pz, r.top, fx, fz);
      }
    }
  }

  // ---------- jumping
  function jump() {
    if (S.action || S.paused || S.over) return;
    if (S.mode === 'foot') {
      const f = S.foot; if (f.air) return;
      const weak = S.en <= 0 ? 0.6 : 1;
      f.air = true; f.vh = JUMP_FOOT * weak; S.en = Math.max(0, S.en - 0.35);
      puff(f.x, f.y, f.z, 7, 2.2); sfx.beep(380, 0.09, 'sine', 0.1); sfx.beep(560, 0.1, 'sine', 0.08, 0.06);
    } else {
      const c = S.car; if (c.air) return;
      const weak = S.en <= 0 ? 0.6 : 1;
      c.air = true; c.vh = JUMP_CAR * weak; S.en = Math.max(0, S.en - 1.1);
      puff(c.x, c.y, c.z, 10, 3.2); sfx.beep(240, 0.12, 'sine', 0.14); sfx.beep(420, 0.12, 'sine', 0.1, 0.07);
    }
  }
  function land(o, strong) {
    o.air = false; o.h = 0; const hard = Math.min(1, Math.abs(o.vh) / 7); o.vh = 0;
    puff(o.x, o.y, o.z, strong ? 12 : 8, 1.4 + hard * 2.2); sfx.beep(strong ? 90 : 130, 0.14, 'triangle', 0.18 * (0.5 + hard));
    return hard;
  }

  // ---------- interaction
  function context() {
    // returns what E would do right now
    if (S.action) return null;
    const f = S.foot, c = S.car;
    if (S.mode === 'car') return Math.abs(c.v) < 3 && !c.air ? { type: 'exit', text: tr('p_exit') } : null;
    if (f.air) return null;
    const nr = nearestRock(f.x, f.z);
    if (nr && nr.d < 3.4 && S.carried < CAP_FOOT) return { type: 'collect', rock: nr.r, text: tr('p_collect') };
    const dRover = distTo(c, f.x, f.z);
    if (S.carried > 0 && dRover < 7 && S.cargo < CAP_CARGO) return { type: 'load', text: tr('p_load') };
    if ((S.cargo > 0 || S.carried > 0) && distTo(DOOR, f.x, f.z) < 9) return { type: 'store', text: tr('p_store') };
    if (dRover < 6) return { type: 'enter', text: tr('p_enter') };
    return null;
  }
  function interact() {
    const c = context(); if (!c) return;
    if (c.type === 'enter') { S.mode = 'car'; S.cam.fpPitch = 0; S.cam.yawOff = 0; attachToSeat(true); sfx.beep(300, 0.1, 'square', 0.12); return; }
    if (c.type === 'exit') {
      S.mode = 'foot'; S.cam.fpPitch = 0; S.cam.yawOff = 0; attachToSeat(false);
      const car = S.car, side = 3.0;
      S.foot.x = car.x + Math.cos(car.yaw) * side; S.foot.z = car.z - Math.sin(car.yaw) * side; S.foot.yaw = car.yaw;
      S.foot.speed = 0; S.foot.y = heightAt(S.foot.x, S.foot.z); S.foot.h = 0; S.foot.vh = 0; S.foot.air = false; sfx.beep(260, 0.1, 'square', 0.12); return;
    }
    if (c.type === 'collect') S.action = { type: 'collect', t: 0, dur: 1.4, rock: c.rock, text: tr('a_collect') };
    if (c.type === 'load') S.action = { type: 'load', t: 0, dur: 1.2, text: tr('a_load') };
    if (c.type === 'store') S.action = { type: 'store', t: 0, dur: 2.0, text: tr('a_store') };
  }
  function attachToSeat(on) {
    if (on) { rover.seat.add(astro.root); astro.root.position.set(0, 0.0, 0); astro.root.rotation.set(0, 0, 0); astro.root.scale.setScalar(0.85); }
    else { scene.add(astro.root); astro.root.scale.setScalar(1); }
  }
  function finishAction() {
    const a = S.action; S.action = null;
    if (a.type === 'collect') {
      a.rock.taken = true; a.rock.mesh.visible = false; a.rock.halo.visible = false;
      S.carried++; a.rock.site.left--; sfx.pick();
      if (a.rock.site.left <= 0) { a.rock.site.beam.material.color.set(0x6b7380); a.rock.site.beam.material.opacity = 0.06; }
    } else if (a.type === 'load') {
      const n = Math.min(S.carried, CAP_CARGO - S.cargo); S.carried -= n; S.cargo += n; sfx.pick();
    } else if (a.type === 'store') {
      const n = S.cargo + S.carried; S.delivered += n; S.cargo = 0; S.carried = 0; sfx.chime();
      S.money += n * REWARD; flash(tr('f_earn', { m: n * REWARD }));
      if (S.delivered >= GOAL) win();
    }
  }

  // ---------- end states
  function endCard(title, text, win_) {
    S.over = true; S.paused = true;
    ovEnd.innerHTML = '<div class="mg-card mg-glass"><h2>' + title + '</h2><p>' + text + '</p><button class="mg-btn pri" id="a" type="button">' + tr('again') +
      '</button><button class="mg-btn" id="q" type="button">' + tr('quit') + '</button></div>';
    ovEnd.style.display = 'flex';
    ovEnd.querySelector('#a').onclick = () => { const o = opts; stop(); start(o); };
    ovEnd.querySelector('#q').onclick = exit;
    sfx.drive(0, false);
  }
  function win() {
    const m = Math.floor(S.t / 60), s = Math.floor(S.t % 60);
    const d = opts.discovery ? opts.discovery.discovery : '';
    endCard(tr('winT'), tr('winD', { d, n: S.delivered, t: m + ':' + String(s).padStart(2, '0') }) + ' ' + tr('money') + ': $' + Math.floor(S.money) + '.', true);
  }
  function lose(cause) { endCard(tr('loseT'), tr(cause), false); }

  // ---------- update
  function radStage() { return S.rad >= 80 ? 3 : S.rad >= 55 ? 2 : S.rad >= 30 ? 1 : 0; }

  function update(dt) {
    S.t += dt;
    const f = S.foot, c = S.car, stage = radStage();
    const stageSpeed = [1, 0.88, 0.72, 0.5][stage];
    const pos = subject();
    const inLab = Math.hypot(pos.x, pos.z) < LAB_RADIUS;

    // ---- movement
    const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const turn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
    if (S.mode === 'foot') {
      if (S.action) {
        S.action.t += dt; if (S.action.t >= S.action.dur) finishAction();
        f.speed = lerp(f.speed, 0, 1 - Math.exp(-10 * dt));
      } else {
        f.yaw += turn * (f.air ? 1.3 : 2.4) * dt;
        const run = keys.ShiftLeft || keys.ShiftRight;
        const target = fwd > 0 ? (run ? 8.5 : 4.6) * stageSpeed : fwd < 0 ? -2.6 : 0;
        f.speed = lerp(f.speed, target, 1 - Math.exp(-(f.air ? 1.2 : 7) * dt));
        const nx = f.x + Math.sin(f.yaw) * f.speed * dt, nz = f.z + Math.cos(f.yaw) * f.speed * dt;
        const dh = heightAt(nx, nz) - heightAt(f.x, f.z);
        const slope = dh / Math.max(0.01, Math.abs(f.speed * dt));
        if (Math.abs(f.speed) < 0.01 || slope < 1.1 || (f.air && f.h > dh + 0.3)) { f.x = nx; f.z = nz; } else f.speed *= 0.3;
        f.x = clamp(f.x, -WORLD, WORLD); f.z = clamp(f.z, -WORLD, WORLD);
      }
      for (let it = 0; it < 3; it++) {          // the base is solid: slide along its walls
        const hit = labContact(f.x, f.z, 0.45); if (!hit) break;
        f.x += hit.nx * hit.pen; f.z += hit.nz * hit.pen; f.speed *= 0.8;
      }
      f.y = heightAt(f.x, f.z);
      if (f.air) {
        f.h += f.vh * dt; f.vh -= JUMP_G * dt;
        if (f.h <= 0 && f.vh < 0) { const hard = land(f, false); f.landT = 0.1 + hard * 0.14; f.speed *= 0.6; }
      }
      f.landT = Math.max(0, f.landT - dt);
      f.phase += Math.abs(f.speed) * dt * (f.air ? 0.3 : 1.7);
    } else {
      // rover physics
      const empty = S.en <= 0, hf = S.rv >= 50 ? 1 : 0.4 + 0.6 * (S.rv / 50);
      let vmax = (empty ? 6 : 34) * stageSpeed * hf; if (S.rv <= 0) vmax = Math.min(vmax, 3);
      const fwdDir = { x: Math.sin(c.yaw), z: Math.cos(c.yaw) };
      const ahead = heightAt(c.x + fwdDir.x * 3, c.z + fwdDir.z * 3) - heightAt(c.x - fwdDir.x * 3, c.z - fwdDir.z * 3);
      const slope = ahead / 6;
      let acc = fwd > 0 ? 15 : fwd < 0 ? -12 : 0;
      if (keys.KeyB) acc = -Math.sign(c.v) * 22;
      acc -= slope * 11;
      if (c.air) acc = 0;                           // no traction in the air
      c.v += acc * dt;
      if (!c.air) {
        c.v -= c.v * 0.18 * dt;                     // rolling drag
        if (!fwd && !keys.KeyB) c.v *= 1 - clamp(0.6 * dt, 0, 1);
      }
      const lim = vmax * clamp(1 - Math.max(0, slope) * 1.3, 0.2, 1);
      c.v = clamp(c.v, -9, lim);
      const steerMax = lerp(0.62, 0.17, clamp(Math.abs(c.v) / 30, 0, 1));
      c.steer = lerp(c.steer, turn * steerMax, 1 - Math.exp(-6 * dt));
      c.yaw += (c.v * Math.tan(c.steer) / 4.6) * dt * (c.air ? 0.35 : 1);
      c.x = clamp(c.x + Math.sin(c.yaw) * c.v * dt, -WORLD, WORLD);
      c.z = clamp(c.z + Math.cos(c.yaw) * c.v * dt, -WORLD, WORLD);
      collideRover(dt);
      if (c.air) {
        c.h += c.vh * dt; c.vh -= JUMP_G_CAR * dt;
        if (c.h <= 0 && c.vh < 0) { const hard = land(c, true); c.v *= 1 - 0.12 * hard; if (hard > 0.7) S.en = Math.max(0, S.en - 0.6); }
      }
      sfx.drive(Math.abs(c.v) / 34 * (c.air ? 0.4 : 1), !empty || Math.abs(c.v) > 0.5);
    }
    if (S.mode !== 'car') sfx.drive(0, false);

    // ---- environment: lab, craters, flare
    const cur = subject();
    S.shadeT -= dt;
    if (S.shadeT <= 0) {
      S.shadeT = 0.3;
      const h0 = heightAt(cur.x, cur.z);
      const rim = (heightAt(cur.x + 45, cur.z) + heightAt(cur.x - 45, cur.z) + heightAt(cur.x, cur.z + 45) + heightAt(cur.x, cur.z - 45)) / 4;
      S.shade = rim - h0 > 7;
    }
    const fl = S.flare; fl.next -= dt;
    if (!fl.on && fl.next < 6 && fl.next > 0) { if (!fl.warn) sfx.alarm(); fl.warn = true; }
    if (!fl.on && fl.next <= 0) { fl.on = true; fl.t = 20; fl.warn = false; sfx.alarm(); }
    if (fl.on) { fl.t -= dt; if (fl.t <= 0) { fl.on = false; fl.next = 80 + Math.random() * 70; } }

    // ---- rover: repair at the lab, smoke when badly damaged
    const carInLab = Math.hypot(c.x, c.z) < LAB_RADIUS;
    S.shake = Math.max(0, S.shake - 2.2 * dt);
    if (S.rv < 35) {
      S.smokeT -= dt;
      if (S.smokeT <= 0) {
        S.smokeT = 0.1 + (S.rv / 35) * 0.3;
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        puff(c.x + fx * 2.0, c.y + c.h + 2.0, c.z + fz * 2.0, 1, 0.4, S.rv <= 0 ? 0x151515 : 0x3a3a3a, 1.6);
      }
    }

    // ---- vitals
    let radRate = 0;
    const carMode = S.mode === 'car';
    if (!inLab) {
      radRate = carMode ? 0.22 : 0.55;
      if (S.shade) radRate *= 0.6;
      if (fl.on) radRate *= 3.5;
    }
    S.rad = clamp(S.rad + radRate * dt - (inLab ? 6 * dt : 0), 0, 100);
    if (inLab) {
      S.o2 = clamp(S.o2 + 12 * dt, 0, 100); S.en = clamp(S.en + 10 * dt, 0, 100);
    } else {
      const runK = !carMode && (keys.ShiftLeft || keys.ShiftRight) && fwd > 0 ? 1.8 : 1;
      S.o2 = clamp(S.o2 - (carMode ? 0.35 : 0.6) * runK * (stage >= 2 ? 1.25 : 1) * dt, 0, 100);
      S.en = clamp(S.en - (carMode ? 0.08 + 0.45 * Math.abs(S.car.v) / 34 : 0.1) * dt, 0, 100);
      let loss = S.rad * 0.002 + [0, 0.1, 0.35, 0.9][stage];
      if (S.o2 <= 0) loss += 4;
      S.hp -= loss * dt; if (loss > 0.4) S.hurtT = 0.25;
    }
    // ---- paid services at the lab
    S.svcT -= dt;
    if (S.svc.heal) {
      const d = Math.min(8 * dt, 100 - S.hp, S.money / HEAL_COST);
      if (!inLab || S.hp >= 99.99) S.svc.heal = false;
      else if (d <= 1e-4) { S.svc.heal = false; flash(tr('f_broke')); }
      else { S.hp += d; S.money -= d * HEAL_COST; if (S.svcT <= 0) { sfx.beep(900, 0.04, 'sine', 0.05); S.svcT = 0.22; } }
    }
    if (S.svc.repair) {
      const d = Math.min(12 * dt, 100 - S.rv, S.money / REPAIR_COST);
      if (!carInLab || S.rv >= 99.99) S.svc.repair = false;
      else if (d <= 1e-4) { S.svc.repair = false; flash(tr('f_broke')); }
      else { S.rv += d; S.money -= d * REPAIR_COST; if (S.svcT <= 0) { sfx.beep(520, 0.04, 'square', 0.04); S.svcT = 0.22; } }
    }
    if (S.hp <= 0) { S.hp = 0; lose(S.o2 <= 0 ? 'lose_o2' : 'lose_rad'); return; }

    // lab door
    const dDoor = Math.hypot(S.foot.x - DOOR.x, S.foot.z - DOOR.z), dCar = Math.hypot(S.car.x - DOOR.x, S.car.z - DOOR.z);
    S.doorOpen = lerp(S.doorOpen, (dDoor < 14 || dCar < 14) ? 1 : 0, 1 - Math.exp(-4 * dt));
    lab.door.position.y = 1.9 + S.doorOpen * 3.4;

    // beeps
    S.lastBeepO2 -= dt;
    if (S.o2 < 20 && !inLab && S.lastBeepO2 <= 0) { sfx.beep(880, 0.1, 'square', 0.14); S.lastBeepO2 = S.o2 < 8 ? 0.6 : 1.4; }

    S.inLab = inLab;

    // entering the base switches to first person; leaving it brings the old view back
    const dBase = Math.hypot(pos.x, pos.z);
    if (!S.inBase && dBase < LAB_RADIUS) { S.inBase = true; if (S.view === 'third') { setView('first'); S.autoFP = true; } }
    else if (S.inBase && dBase > LAB_RADIUS + 4) { S.inBase = false; if (S.autoFP) { setView('third'); S.autoFP = false; } }
  }

  // ---------- visuals
  const tmpV = new THREE.Vector3();
  function poseCharacters(dt) {
    const f = S.foot, c = S.car;
    // rover pose from 4 wheel contacts
    const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
    const ph = (lx, lz) => heightAt(c.x + lx * co + lz * si, c.z - lx * si + lz * co);
    const hFL = ph(1.6, 2.1), hFR = ph(-1.6, 2.1), hRL = ph(1.6, -2.1), hRR = ph(-1.6, -2.1);
    const targetY = (hFL + hFR + hRL + hRR) / 4;
    const pitch = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, 4.2), roll = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, 3.2);
    const k = 1 - Math.exp(-12 * dt);
    c.y = targetY; c.pitch = lerp(c.pitch, pitch, 1 - Math.exp(-20 * dt)); c.roll = lerp(c.roll, roll, 1 - Math.exp(-20 * dt));
    rover.root.position.set(c.x, c.y + c.h, c.z);
    rover.root.rotation.set(0, c.yaw, 0);
    const bodyPitch = c.pitch + (c.air ? clamp(c.vh * 0.035, -0.25, 0.25) : 0);
    rover.body.rotation.set(-bodyPitch, 0, c.roll);
    // suspension: every wheel reaches the real ground under it
    rover.wheels.forEach(w => {
      const lx = w.position.x, lz = w.position.z;
      const plane = c.y + c.h + lz * Math.sin(bodyPitch) + lx * Math.sin(c.roll);
      const want = clamp(heightAt(c.x + lx * co + lz * si, c.z - lx * si + lz * co) - plane, -0.55, 0.4);
      w.position.y = 0.72 + want - 0.04;
    });
    rover.wheels.forEach((w, i) => { w.children[0].rotation.x += c.v * dt / 0.72; w.children[1].rotation.x = w.children[0].rotation.x; if (i < 2) w.rotation.y = c.steer * 0.7; });
    rover.cargoRocks.forEach((r, i) => { r.visible = i < S.cargo; });

    // astronaut
    astro.root.visible = S.view !== 'first';
    rover.hood.visible = !(S.view === 'first' && S.mode === 'car');   // keep the windscreen view clear
    if (S.mode === 'foot') {
      astro.root.position.set(f.x, f.y + f.h, f.z); astro.root.rotation.set(0, f.yaw, 0);
      const sw = Math.sin(f.phase) * Math.min(1, Math.abs(f.speed) / 4) * 0.8;
      astro.legL.rotation.x = sw; astro.legR.rotation.x = -sw; astro.armL.rotation.x = -sw * 0.8; astro.armR.rotation.x = sw * 0.8;
      let lean = 0, crouch = 0;
      if (S.action) { const p = S.action.t / S.action.dur; lean = Math.sin(p * Math.PI) * 0.55; crouch = Math.sin(p * Math.PI) * 0.25; astro.armL.rotation.x = astro.armR.rotation.x = -1.0 * Math.sin(p * Math.PI); }
      if (f.air) {
        const up = clamp(f.vh / JUMP_FOOT, -1, 1);          // +1 rising, -1 falling
        astro.armL.rotation.x = astro.armR.rotation.x = -1.6 - up * 0.5;
        astro.armL.rotation.z = 0.3 + (1 - up) * 0.25; astro.armR.rotation.z = -(0.3 + (1 - up) * 0.25);
        astro.legL.rotation.x = -0.7 * (0.5 + up * 0.5) + 0.1; astro.legR.rotation.x = 0.35 + (1 - up) * 0.15;
        lean = 0.12 * up;
      } else { astro.armL.rotation.z = 0; astro.armR.rotation.z = 0; }
      if (f.landT > 0) crouch = Math.max(crouch, f.landT * 2.2);
      astro.body.rotation.x = lean; astro.body.position.y = -crouch;
    } else {
      astro.legL.rotation.x = astro.legR.rotation.x = -1.35; astro.armL.rotation.x = astro.armR.rotation.x = -0.9; astro.armL.rotation.z = astro.armR.rotation.z = 0;
      astro.body.rotation.x = 0; astro.body.position.y = 0.02;
    }
    // carried rocks glow in the backpack indicator is HUD-only
  }

  function updateCamera(dt) {
    const s = subject(), cam = S.cam, car = S.mode === 'car';
    cam.idle += dt;
    const fp = S.view === 'first';
    cross.style.display = fp && !car ? 'block' : 'none';
    if (!dragging && cam.idle > (fp ? 1.2 : 2.5)) cam.yawOff = lerp(cam.yawOff, 0, 1 - Math.exp(-1.5 * dt));
    if (fp) {
      // first person: eyes of the astronaut, or the driver's seat of the rover
      let ex, ey, ez, yaw;
      if (car) {
        rover.root.updateMatrixWorld(true); rover.eye.getWorldPosition(tmpV);
        ex = tmpV.x; ey = tmpV.y; ez = tmpV.z; yaw = s.yaw + cam.yawOff;
      } else {
        const bob = s.air ? 0 : Math.sin(s.phase * 2) * 0.045 * Math.min(1, Math.abs(s.speed) / 4);
        const crouch = S.action ? Math.sin(S.action.t / S.action.dur * Math.PI) * 0.35 : s.landT > 0 ? s.landT * 1.2 : 0;
        ex = s.x + Math.sin(s.yaw) * 0.14; ez = s.z + Math.cos(s.yaw) * 0.14; ey = s.y + s.h + 1.68 + bob - crouch; yaw = s.yaw;
      }
      const p = cam.fpPitch, cp = Math.cos(p);
      camera.position.set(ex, ey, ez);
      camera.lookAt(ex + Math.sin(yaw) * cp, ey + Math.sin(p), ez + Math.cos(yaw) * cp);
      cam.x = ex; cam.y = ey; cam.z = ez; cam.yaw = yaw;
      if (S.shake > 0.01) { camera.position.x += (Math.random() - 0.5) * S.shake * 0.35; camera.position.y += (Math.random() - 0.5) * S.shake * 0.35; }
      const tx = s.x, ty = s.y + 1.5, tz = s.z;
      sunLight.position.set(tx + SUN.x * 220, ty + SUN.y * 220, tz + SUN.z * 220);
      sunLight.target.position.set(tx, ty, tz); sunLight.target.updateMatrixWorld();
      stars.position.copy(camera.position);
      earth.position.set(camera.position.x - 3300, 2200, camera.position.z - 4300);
      sunSpr.position.set(camera.position.x + SUN.x * 5600, SUN.y * 5600, camera.position.z + SUN.z * 5600);
      return;
    }
    const targetYaw = s.yaw + cam.yawOff;
    cam.yaw += angDiff(cam.yaw, targetYaw) * (1 - Math.exp(-(car ? 3.2 : 4.5) * dt));
    const dist = (car ? 14.5 : 6.6) * cam.zoom, pitch = (car ? 0.3 : 0.34) + cam.pitchOff;
    const ty = s.y + s.h * 0.55 + (car ? 2.0 : 1.5);
    const tx = s.x, tz = s.z;
    const cx = tx - Math.sin(cam.yaw) * Math.cos(pitch) * dist, cz = tz - Math.cos(cam.yaw) * Math.cos(pitch) * dist;
    let cy = ty + Math.sin(pitch) * dist + (car ? 1.2 : 0.6);
    cy = Math.max(cy, heightAt(cx, cz) + 1.6);
    const k = 1 - Math.exp(-14 * dt);
    cam.x = lerp(cam.x, cx, k); cam.y = lerp(cam.y, cy, k); cam.z = lerp(cam.z, cz, k);
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(tx + Math.sin(cam.yaw) * 2, ty + 0.3, tz + Math.cos(cam.yaw) * 2);
    if (S.shake > 0.01) camera.position.set(cam.x + (Math.random() - 0.5) * S.shake * 0.5, cam.y + (Math.random() - 0.5) * S.shake * 0.5, cam.z + (Math.random() - 0.5) * S.shake * 0.4);
    // light & sky follow
    sunLight.position.set(tx + SUN.x * 220, ty + SUN.y * 220, tz + SUN.z * 220);
    sunLight.target.position.set(tx, ty, tz); sunLight.target.updateMatrixWorld();
    stars.position.copy(camera.position);
    earth.position.set(camera.position.x - 3300, 2200, camera.position.z - 4300);
    sunSpr.position.set(camera.position.x + SUN.x * 5600, SUN.y * 5600, camera.position.z + SUN.z * 5600);
  }

  // ---------- HUD
  let hudT = 0, mapT = 0;
  function objective() {
    const f = S.foot, c = S.car, carrying = S.carried + S.cargo;
    const farFromLab = Math.hypot(f.x, f.z) > 60;
    if (S.mode === 'car') {
      if (carrying > 0) return { text: tr('obj_return'), tx: DOOR.x, tz: DOOR.z, label: tr('tgt_lab') };
      const s = nearestSite(c.x, c.z);
      return { text: tr('obj_drive'), tx: s.x, tz: s.z, label: tr('site') + ' ' + s.name };
    }
    const nr = nearestRock(f.x, f.z);
    if (nr && nr.d < 120 && S.carried < CAP_FOOT) return { text: tr('obj_collect'), tx: nr.r.x, tz: nr.r.z, label: tr('tgt_rock') };
    if (S.carried > 0) return { text: tr('obj_load'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
    if (nr && nr.d < 260) return { text: tr('obj_collect'), tx: nr.r.x, tz: nr.r.z, label: tr('tgt_rock') };
    if (S.cargo > 0) {
      if (distTo(c, DOOR.x, DOOR.z) < 70) return { text: tr('obj_store'), tx: DOOR.x, tz: DOOR.z, label: tr('tgt_lab') };
      return { text: tr('obj_walkRover'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
    }
    if (!farFromLab && S.t < 3) return { text: tr('obj_exitLab'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
    return { text: tr('obj_getRover'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
  }
  function nearestSite(x, z) {
    let best = SITES[0], bd = 1e9;
    for (const s of SITES) { if (s.left <= 0) continue; const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  function drawMap() {
    const w = 372, h = 186 * 2, R = 2200, cx = w / 2, cy = h / 2, k = (w / 2 - 6) / R;
    const s = subject();
    mctx.clearRect(0, 0, w, h);
    mctx.save(); mctx.beginPath(); mctx.arc(cx, cy, cx - 2, 0, 7); mctx.clip();
    mctx.fillStyle = '#0a1426'; mctx.fillRect(0, 0, w, h);
    // north-up map: +x right, +z up
    const mx = x => cx + (x - s.x) * k, mz = z => cy - (z - s.z) * k;
    // world border
    mctx.strokeStyle = 'rgba(255,120,100,.7)'; mctx.lineWidth = 2;
    mctx.strokeRect(mx(-WORLD), mz(WORLD), 2 * WORLD * k, 2 * WORLD * k);
    mctx.strokeStyle = 'rgba(127,227,255,.14)'; mctx.lineWidth = 1;
    for (let r = 1; r <= 3; r++) { mctx.beginPath(); mctx.arc(cx, cy, (cx - 6) * r / 3, 0, 7); mctx.stroke(); }
    mctx.beginPath(); mctx.moveTo(cx, 4); mctx.lineTo(cx, h - 4); mctx.moveTo(4, cy); mctx.lineTo(w - 4, cy); mctx.stroke();
    // sites
    SITES.forEach(si => {
      mctx.beginPath(); mctx.arc(mx(si.x), mz(si.z), Math.max(5, si.R * k), 0, 7);
      mctx.fillStyle = si.left > 0 ? 'rgba(255,200,90,.28)' : 'rgba(150,160,175,.18)'; mctx.fill();
      mctx.strokeStyle = si.left > 0 ? '#ffc65a' : '#7d8794'; mctx.lineWidth = 2; mctx.stroke();
    });
    // lab
    mctx.fillStyle = '#7fe3ff'; mctx.fillRect(mx(0) - 7, mz(0) - 7, 14, 14);
    mctx.strokeStyle = 'rgba(127,227,255,.5)'; mctx.beginPath(); mctx.arc(mx(0), mz(0), LAB_RADIUS * k + 3, 0, 7); mctx.stroke();
    // rover
    if (S.mode === 'foot') { mctx.fillStyle = '#ff9a4d'; mctx.fillRect(mx(S.car.x) - 5, mz(S.car.z) - 5, 10, 10); }
    // player
    mctx.translate(cx, cy); mctx.rotate(Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw)));
    mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.moveTo(0, -11); mctx.lineTo(8, 9); mctx.lineTo(0, 4); mctx.lineTo(-8, 9); mctx.closePath(); mctx.fill();
    mctx.restore();
    mctx.fillStyle = '#eef4ff'; mctx.font = 'bold 18px sans-serif'; mctx.textAlign = 'center'; mctx.fillText('N', cx, 20);
  }
  const carInLabNow = () => Math.hypot(S.car.x, S.car.z) < LAB_RADIUS;
  function updateHud() {
    const vals = { health: S.hp, oxygen: S.o2, energy: S.en, rover: S.rv, radiation: S.rad };
    BARS.forEach(([k]) => {
      const v = vals[k], b = bar[k];
      b.f.style.width = v + '%';
      b.v.textContent = k === 'radiation' ? Math.round(v) + '% · ' + tr('st_' + ['ok', 'fatigue', 'illness', 'injury'][radStage()]) : Math.round(v) + '%';
      b.row.classList.toggle('low', k === 'radiation' ? v >= 55 : v < 22);
    });
    inv.innerHTML = tr('money') + ' <b>$' + Math.floor(S.money) + '</b><br>' + tr('delivered') + ' <b>' + S.delivered + ' / ' + GOAL + '</b><br>' + tr('carrying') + ' <b>' + S.carried + ' / ' + CAP_FOOT + '</b><br>' + tr('cargo') + ' <b>' + S.cargo + ' / ' + CAP_CARGO + '</b>';
    const o = objective(); objB.textContent = o.text;
    objS.textContent = tr('delivered') + ': ' + S.delivered + ' / ' + GOAL;
    objP.style.width = (S.delivered / GOAL * 100) + '%';
    const s = subject();
    spB.textContent = Math.round(Math.abs(S.mode === 'car' ? S.car.v : S.foot.speed) * 3.6); spU.textContent = tr('kmh');
    const dx = o.tx - s.x, dz = o.tz - s.z, d = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, dz), rel = angDiff(S.cam.yaw, bearing);
    arrow.style.transform = 'rotate(' + (-rel * 180 / Math.PI) + 'deg)';
    tgtB.textContent = o.label; tgtS.textContent = d >= 1000 ? (d / 1000).toFixed(2) + ' km' : Math.round(d) + ' m';
    // prompt / action
    const ctx = context();
    if (S.action) { action.style.display = 'block'; actT.textContent = S.action.text; actP.style.width = (S.action.t / S.action.dur * 100) + '%'; prompt.style.display = 'none'; }
    else {
      action.style.display = 'none';
      if (ctx) { prompt.innerHTML = ctx.text.replace(/E/, '<kbd>E</kbd>'); prompt.style.display = 'block'; } else prompt.style.display = 'none';
    }
    // warnings
    let w = '', red = false;
    const fl = S.flare;
    if (fl.on) { w = tr('w_flare'); red = true; }
    else if (performance.now() < S.hitUntil) { w = tr('w_hit', { d: S.lastDmg }); red = true; }
    else if (fl.warn) w = tr('w_flareSoon', { s: Math.max(1, Math.ceil(fl.next)) });
    else if (S.o2 < 20 && !S.inLab) { w = tr('w_o2'); red = true; }
    else if (S.en <= 0 && S.mode === 'car') { w = tr('w_en'); red = true; }
    else if (S.rad >= 55 && !S.inLab) { w = tr('w_rad'); red = true; }
    else if (S.rv < 25 && S.mode === 'car' && !carInLabNow()) { w = tr(S.rv <= 0 ? 'w_rv0' : 'w_rv1'); red = true; }
    else if (Math.max(Math.abs(s.x), Math.abs(s.z)) > WORLD - 250) { w = tr('w_edge'); }
    warn.style.display = w ? 'block' : 'none'; warn.textContent = w; warn.classList.toggle('red', red);
    const refilling = S.inLab && (S.o2 < 99.5 || S.en < 99.5) && !w;
    msg.style.display = refilling ? 'block' : 'none'; msg.textContent = tr('m_refill');
    // paid services prompt
    const lines = [];
    if (S.inLab && S.hp < 99.5) lines.push(S.svc.heal ? tr('s_healing') : tr('s_heal', { c: '$' + Math.ceil((100 - S.hp) * HEAL_COST) }));
    if (carInLabNow() && S.rv < 99.5) lines.push(S.svc.repair ? tr('s_repairing') : tr('s_repair', { c: '$' + Math.ceil((100 - S.rv) * REPAIR_COST) }));
    svc.innerHTML = lines.map(l => '<div>' + l + '</div>').join(''); svc.style.display = lines.length && !S.action ? 'block' : 'none';
    viewTag.style.opacity = performance.now() < S.viewUntil ? 1 : 0;
    vig.style.opacity = fl.on ? (0.55 + 0.25 * Math.sin(S.t * 6)) : 0;
    S.hurtT = Math.max(0, S.hurtT - 0.016); hurt.style.opacity = S.hurtT > 0 ? Math.min(1, S.hurtT * 3) : 0;
    // light flicker during flare
    sunLight.color.set(fl.on ? 0xffb894 : 0xfff1dc);
  }

  // ---------- loop
  let last = performance.now(), px0 = 1e9, pz0 = 1e9;
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!S.paused && !S.over) update(dt);
    poseCharacters(dt);
    if (!S.paused) updateDust(dt);
    const s = subject();
    if (Math.floor(s.x / CS) !== Math.floor(px0 / CS) || Math.floor(s.z / CS) !== Math.floor(pz0 / CS)) { planChunks(s.x, s.z, false); px0 = s.x; pz0 = s.z; }
    processQueue(5);
    updateCamera(dt);
    hudT -= dt; if (hudT <= 0) { hudT = 0.05; updateHud(); }
    mapT -= dt; if (mapT <= 0) { mapT = 0.15; drawMap(); }
    renderer.render(scene, camera);
  }

  // ---------- boot
  applyDom();
  ovHelp.style.display = 'none';
  onResize();
  load.style.display = 'flex';
  S.cam.yaw = S.foot.yaw; S.cam.x = S.foot.x; S.cam.z = S.foot.z - 8;
  setTimeout(() => {
    if (destroyed) return;
    planChunks(S.foot.x, S.foot.z, true); px0 = S.foot.x; pz0 = S.foot.z;
    if (opts.contrast && opts.contrast !== 1) canvas.style.filter = 'contrast(' + opts.contrast + ')';
    load.style.display = 'none';
    ovHelp.style.display = 'flex';
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }, 60);

  // ---------- API
  return {
    setLang(l) { if (T[l]) { lang = l; const helpOpen = ovHelp.style.display === 'flex', pauseOpen = ovPause.style.display === 'flex'; applyDom(); ovHelp.style.display = helpOpen ? 'flex' : 'none'; ovPause.style.display = pauseOpen ? 'flex' : 'none'; } },
    setVolume(v) { sfx.setVolume(v); },
    setContrast(c) { canvas.style.filter = c === 1 ? '' : 'contrast(' + c + ')'; },
    destroy() {
      destroyed = true; cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize); window.removeEventListener('blur', onBlur);
      for (const [, c] of chunks) removeChunk(c); chunks.clear();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      Object.values(M).forEach(m => m.dispose()); terrainMat.dispose(); detailTex.dispose(); earthTex.dispose();
      sfx.close(); renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      container.innerHTML = '';
    },
    _debug: { S, rover, astro, lab, camera, scene, renderer, SITES, rocks, update, frame }
  };
}

window.MoonGame = {
  start, stop,
  isRunning: () => !!G,
  setLang: l => { if (G) G.setLang(l); },
  setVolume: v => { if (G) G.setVolume(v); },
  setContrast: c => { if (G) G.setContrast(c); },
  _g: () => G
};
