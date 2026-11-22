// Türkçe anatomik terim ve klinik not zenginleştirme sözlüğü
// Z-Anatomy'den gelen 3.600+ İngilizce/Latince TA2 mesh adını Türkçe karşılıklarla eşleştirir.

export const TR_CLINICAL_NOTES = {
  cranium: 'Nörokraniyum beyni çevreler; pterion bölgesi A. meningea media komşuluğu nedeniyle travmada kritiktir.',
  mandible: 'Kafatasının tek hareketli kemiğidir; temporomandibular eklem (TME) ile çiğnemeyi sağlar.',
  clavicle: 'Üst ekstremiteyi aksiyal iskelete bağlayan tek kemik köprüdür; en sık orta 1/3 kısmından kırılır.',
  scapula: 'Glenoid kavite ile humerus başını taşır; N. thoracicus longus felcinde kanat skapula gelişir.',
  sternum: 'Manubrium, corpus ve xiphoid çıkıntıdan oluşur; median sternotomi ve kemik iliği aspirasyonunda önemlidir.',
  humerus: 'Cerrahi boynundan N. axillaris, radial oluğundan N. radialis, medial epikondilinden N. ulnaris geçer.',
  femur: 'Vücudun en uzun ve güçlü kemiğidir; femur boyun kırıkları femur başı avasküler nekrozuna yol açabilir.',
  patella: 'M. quadriceps femoris tendonu içindeki en büyük sesamoid kemiktir.',
  tibia: 'Alt bacağın ana ağırlık taşıyan medial kemiğidir.',
  fibula: 'Boyun kısmından geçen N. fibularis communis hasarında düşük ayak gelişir.',
  heart: 'Dört odacıklı kas pompası; sağ ve sol koroner arterlerle beslenir, apex 5. sol interkostal aralıktadır.',
  aorta: 'Sol ventrikülden çıkıp arkus aorta, torasik ve abdominal aorta olarak L4 düzeyinde iliak arterlere ayrılır.',
  lung: 'Sağ akciğer 3 lobludur; sol akciğer 2 lobludur ve kardiyak çentik taşır.',
  trachea: 'C6-T4 arasında uzanan C-şekilli hiyalin kıkırdaklı hava yoludur; karinada ana bronşlara ayrılır.',
  liver: 'Sağ üst kadranda en büyük solid organdır; %75 V. portae, %25 A. hepatica ile kanlanır.',
  stomach: 'Truncus coeliacus dallarıyla beslenir; N. vagus asit ve motiliteyi artırır.',
  spleen: 'Sol üst kadranda 9–11. kaburgalar derininde yer alır; künt travmada en sık yaralanan organdır.',
  pancreas: 'Retroperitoneal yerleşimlidir; hem ekzokrin sindirim enzimleri hem endokrin insülin/glukagon üretir.',
  kidney: 'T12–L3 retroperitoneal; sağ böbrek karaciğer nedeniyle sola göre biraz daha aşağıdadır.',
  brain: 'Willis poligonu ile beslenir; frontal, parietal, temporal ve oksipital loblardan oluşur.',
  cerebellum: 'Arka kraniyal fossada denge ve ince motor koordinasyonu yönetir.',
  'spinal cord': 'Foramen magnumdan L1–L2 conus medullaris düzeyine kadar uzanır.'
};

export function findClinicalNote(meshName) {
  const lower = meshName.toLowerCase();
  for (const [key, note] of Object.entries(TR_CLINICAL_NOTES)) {
    if (lower.includes(key)) return note;
  }
  return '';
}
