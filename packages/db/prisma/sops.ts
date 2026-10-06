// ECCS's standard SOPs. SAMPLE WORDING written for development: the founder
// is to replace it with ECCS's real SOPs, and the Telugu and Hindi need a
// native speaker's review. Each line of a body is one step.
//
// Loading is safe to repeat: SOPs are matched by code, so it updates these
// and leaves anything added in the console or by restaurants alone.

import type { PrismaClient } from "../src/index.js";

interface SampleSop {
  code: string;
  category: string;
  title: [en: string, te: string, hi: string];
  steps: [en: string, te: string, hi: string][];
}

export const SAMPLE_SOPS: SampleSop[] = [
  {
    code: "SOP-KIT-001",
    category: "CLEANING",
    title: ["Daily kitchen hygiene", "రోజువారీ వంటగది పరిశుభ్రత", "दैनिक रसोई स्वच्छता"],
    steps: [
      ["Wash hands before handling food.", "ఆహారాన్ని తాకే ముందు చేతులు కడుక్కోండి.", "खाना छूने से पहले हाथ धोएं।"],
      ["Sanitise prep surfaces before and after each shift.", "ప్రతి షిఫ్ట్‌కు ముందు, తర్వాత పని ఉపరితలాలను శానిటైజ్ చేయండి.", "हर शिफ्ट से पहले और बाद में काम की सतहों को सैनिटाइज़ करें।"],
      ["Keep raw and cooked food apart, with separate boards and knives.", "పచ్చి, వండిన ఆహారాన్ని వేరుగా ఉంచండి; వేర్వేరు బోర్డులు, కత్తులు వాడండి.", "कच्चा और पका खाना अलग रखें; अलग बोर्ड और चाकू इस्तेमाल करें।"],
      ["Record fridge and freezer temperatures twice a day.", "ఫ్రిజ్, ఫ్రీజర్ ఉష్ణోగ్రతలను రోజుకు రెండుసార్లు నమోదు చేయండి.", "फ्रिज और फ्रीज़र का तापमान दिन में दो बार दर्ज करें।"],
      ["Sweep and mop the floor, and clean the drains, at closing.", "మూసే సమయంలో నేల ఊడ్చి తుడవండి, డ్రెయిన్‌లు శుభ్రం చేయండి.", "बंद करते समय फर्श पर झाड़ू-पोछा करें और नालियां साफ करें।"],
      ["Empty and wash the bins at closing.", "మూసే సమయంలో చెత్త డబ్బాలను ఖాళీ చేసి కడగండి.", "बंद करते समय कूड़ेदान खाली करके धोएं।"],
    ],
  },
  {
    code: "SOP-HYG-001",
    category: "PERSONAL_HYGIENE",
    title: ["Hand washing", "చేతులు కడుక్కోవడం", "हाथ धोना"],
    steps: [
      ["Wet your hands with clean running water.", "శుభ్రమైన పారే నీటితో చేతులు తడపండి.", "साफ बहते पानी से हाथ गीले करें।"],
      ["Apply soap and rub palms, backs of hands, between fingers and under nails for 20 seconds.", "సబ్బు రాసి అరచేతులు, చేతుల వెనుక, వేళ్ల మధ్య, గోళ్ల కింద 20 సెకన్లు రుద్దండి.", "साबुन लगाकर हथेलियां, हाथों के पीछे, उंगलियों के बीच और नाखूनों के नीचे 20 सेकंड तक रगड़ें।"],
      ["Rinse well and dry with a clean paper towel, not your apron.", "బాగా కడిగి శుభ్రమైన పేపర్ టవల్‌తో తుడుచుకోండి; ఏప్రాన్‌తో కాదు.", "अच्छी तरह धोकर साफ पेपर टॉवल से सुखाएं, एप्रन से नहीं।"],
      ["Wash before starting work, after the toilet, after touching raw meat, waste, money or your phone.", "పని మొదలుపెట్టే ముందు, టాయిలెట్ తర్వాత, పచ్చి మాంసం, చెత్త, డబ్బు లేదా ఫోన్ తాకిన తర్వాత కడుక్కోండి.", "काम शुरू करने से पहले, शौचालय के बाद, कच्चा मांस, कचरा, पैसे या फोन छूने के बाद हाथ धोएं।"],
      ["Cover cuts with a waterproof dressing and wear a glove over it.", "గాయాలను నీరు చొరబడని పట్టీతో కప్పి, దానిపై గ్లవ్ ధరించండి.", "कटे घाव को वॉटरप्रूफ पट्टी से ढकें और ऊपर दस्ताना पहनें।"],
    ],
  },
  {
    code: "SOP-STO-001",
    category: "FOOD_STORAGE",
    title: ["Fridge and freezer storage", "ఫ్రిజ్ మరియు ఫ్రీజర్ నిల్వ", "फ्रिज और फ्रीज़र में भंडारण"],
    steps: [
      ["Keep the fridge at 5°C or below and the freezer at -18°C or below.", "ఫ్రిజ్‌ను 5°C లేదా అంతకంటే తక్కువ, ఫ్రీజర్‌ను -18°C లేదా అంతకంటే తక్కువ ఉంచండి.", "फ्रिज 5°C या उससे कम और फ्रीज़र -18°C या उससे कम पर रखें।"],
      ["Store cooked and ready-to-eat food above raw meat, fish and eggs.", "వండిన, తినడానికి సిద్ధంగా ఉన్న ఆహారాన్ని పచ్చి మాంసం, చేపలు, గుడ్ల పైన ఉంచండి.", "पका और खाने के लिए तैयार भोजन कच्चे मांस, मछली और अंडों के ऊपर रखें।"],
      ["Cover every container and label it with the food name, date made and use-by date.", "ప్రతి డబ్బాను మూసి, ఆహారం పేరు, తయారు చేసిన తేదీ, గడువు తేదీతో లేబుల్ వేయండి.", "हर डिब्बे को ढकें और उस पर खाने का नाम, बनाने की तारीख और उपयोग की अंतिम तारीख लिखें।"],
      ["Use the oldest stock first.", "ముందు పాత స్టాక్‌ను వాడండి.", "पहले पुराना स्टॉक इस्तेमाल करें।"],
      ["Throw away anything past its use-by date or without a label.", "గడువు దాటినవి లేదా లేబుల్ లేనివి పారవేయండి.", "जिसकी तारीख निकल गई हो या जिस पर लेबल न हो, उसे फेंक दें।"],
      ["Do not overfill: leave space for cold air to move.", "ఎక్కువగా నింపవద్దు: చల్లని గాలి తిరగడానికి ఖాళీ ఉంచండి.", "ज़्यादा न भरें: ठंडी हवा घूमने के लिए जगह छोड़ें।"],
    ],
  },
  {
    code: "SOP-EQP-001",
    category: "EQUIPMENT",
    title: ["Chimney and hood filters", "చిమ్నీ మరియు హుడ్ ఫిల్టర్లు", "चिमनी और हुड के फ़िल्टर"],
    steps: [
      ["Switch off the burners and the exhaust, and let the hood cool.", "బర్నర్లు, ఎగ్జాస్ట్ ఆపి, హుడ్ చల్లబడే వరకు ఆగండి.", "बर्नर और एग्ज़ॉस्ट बंद करें और हुड को ठंडा होने दें।"],
      ["Remove the grease filters and soak them in hot water with degreaser for 20 minutes.", "గ్రీజ్ ఫిల్టర్లను తీసి, డీగ్రీజర్ కలిపిన వేడి నీటిలో 20 నిమిషాలు నానబెట్టండి.", "ग्रीस फ़िल्टर निकालकर डीग्रीज़र मिले गर्म पानी में 20 मिनट भिगोएं।"],
      ["Scrub, rinse and dry the filters completely before refitting.", "ఫిల్టర్లను రుద్ది, కడిగి, పూర్తిగా ఆరిన తర్వాతే తిరిగి అమర్చండి.", "फ़िल्टर को रगड़ें, धोएं और पूरी तरह सुखाकर ही वापस लगाएं।"],
      ["Wipe the inside and outside of the hood and empty the grease tray.", "హుడ్ లోపల, బయట తుడిచి, గ్రీజ్ ట్రేను ఖాళీ చేయండి.", "हुड को अंदर और बाहर से पोंछें और ग्रीस ट्रे खाली करें।"],
      ["Clean the filters every week; ECCS deep cleans the duct on its scheduled visit.", "ఫిల్టర్లను ప్రతి వారం శుభ్రం చేయండి; డక్ట్‌ను ECCS తన షెడ్యూల్ విజిట్‌లో డీప్ క్లీన్ చేస్తుంది.", "फ़िल्टर हर हफ्ते साफ करें; डक्ट की गहरी सफाई ECCS अपनी तय विज़िट में करता है।"],
    ],
  },
  {
    code: "SOP-PST-001",
    category: "PEST_CONTROL",
    title: ["Keeping pests out", "పురుగులు, ఎలుకలు రాకుండా చూడటం", "कीटों को दूर रखना"],
    steps: [
      ["Keep doors closed and check that fly screens and door strips are in place.", "తలుపులు మూసి ఉంచండి; ఫ్లై స్క్రీన్‌లు, డోర్ స్ట్రిప్‌లు సరిగ్గా ఉన్నాయో చూడండి.", "दरवाज़े बंद रखें और देखें कि जाली और डोर स्ट्रिप अपनी जगह पर हैं।"],
      ["Store all food off the floor in closed containers.", "ఆహారమంతా నేలపై కాకుండా, మూత ఉన్న డబ్బాల్లో నిల్వ చేయండి.", "सारा खाना फर्श से ऊपर, बंद डिब्बों में रखें।"],
      ["Clean spills and crumbs straight away, including under equipment.", "ఒలికినవి, ముక్కలను వెంటనే శుభ్రం చేయండి; పరికరాల కింద కూడా.", "गिरा हुआ सामान और टुकड़े तुरंत साफ करें, उपकरणों के नीचे भी।"],
      ["Check for droppings, gnaw marks and dead insects every morning.", "ప్రతి ఉదయం రెట్టలు, కొరికిన గుర్తులు, చనిపోయిన పురుగులు ఉన్నాయేమో చూడండి.", "हर सुबह मल, कुतरने के निशान और मरे कीड़े जांचें।"],
      ["If you see a pest, raise an issue with ECCS in the app with a photo. Do not spray near food.", "పురుగు కనిపిస్తే, యాప్‌లో ఫోటోతో ECCSకి సమస్యను తెలియజేయండి. ఆహారం దగ్గర స్ప్రే చేయవద్దు.", "कीट दिखे तो ऐप में फोटो के साथ ECCS को समस्या बताएं। खाने के पास स्प्रे न करें।"],
    ],
  },
  {
    code: "SOP-WST-001",
    category: "WASTE",
    title: ["Waste and bins", "చెత్త మరియు డబ్బాలు", "कचरा और कूड़ेदान"],
    steps: [
      ["Use bins with lids and a foot pedal, lined with a bag.", "మూత, ఫుట్ పెడల్ ఉన్న డబ్బాలను సంచి వేసి వాడండి.", "ढक्कन और पैडल वाले कूड़ेदान थैली लगाकर इस्तेमाल करें।"],
      ["Keep wet waste and dry waste in separate bins.", "తడి చెత్త, పొడి చెత్తను వేర్వేరు డబ్బాల్లో ఉంచండి.", "गीला और सूखा कचरा अलग कूड़ेदान में रखें।"],
      ["Empty bins when three-quarters full, and always at closing.", "డబ్బా ముప్పావు నిండినప్పుడు, మూసే సమయంలో తప్పకుండా ఖాళీ చేయండి.", "कूड़ेदान तीन-चौथाई भरने पर और बंद करते समय ज़रूर खाली करें।"],
      ["Wash and sanitise the bins every day, then wash your hands.", "డబ్బాలను ప్రతిరోజూ కడిగి శానిటైజ్ చేయండి, తర్వాత చేతులు కడుక్కోండి.", "कूड़ेदान रोज़ धोकर सैनिटाइज़ करें, फिर हाथ धोएं।"],
      ["Keep the outside waste area closed and clean.", "బయటి చెత్త ప్రదేశాన్ని మూసి, శుభ్రంగా ఉంచండి.", "बाहर का कचरा क्षेत्र बंद और साफ रखें।"],
    ],
  },
  {
    code: "SOP-SAF-001",
    category: "SAFETY",
    title: ["Gas and fire safety", "గ్యాస్ మరియు అగ్ని భద్రత", "गैस और आग से सुरक्षा"],
    steps: [
      ["Check gas pipes and regulators for leaks or cracks before lighting.", "వెలిగించే ముందు గ్యాస్ పైపులు, రెగ్యులేటర్లలో లీక్ లేదా పగుళ్లు ఉన్నాయేమో చూడండి.", "जलाने से पहले गैस पाइप और रेगुलेटर में रिसाव या दरार जांचें।"],
      ["If you smell gas, do not switch anything on or off. Close the cylinder valve, open doors and tell the manager.", "గ్యాస్ వాసన వస్తే ఏ స్విచ్‌నూ వేయవద్దు, ఆపవద్దు. సిలిండర్ వాల్వ్ మూసి, తలుపులు తెరిచి, మేనేజర్‌కు చెప్పండి.", "गैस की गंध आए तो कोई स्विच चालू या बंद न करें। सिलेंडर का वाल्व बंद करें, दरवाज़े खोलें और मैनेजर को बताएं।"],
      ["Never leave hot oil unattended. Smother an oil fire with a lid or fire blanket, never water.", "వేడి నూనెను గమనించకుండా వదలవద్దు. నూనె మంటను మూత లేదా ఫైర్ బ్లాంకెట్‌తో ఆర్పండి; నీళ్లు పోయవద్దు.", "गर्म तेल को बिना निगरानी न छोड़ें। तेल की आग ढक्कन या फायर ब्लैंकेट से बुझाएं, पानी कभी न डालें।"],
      ["Keep the fire extinguisher within reach and its gauge in the green.", "ఫైర్ ఎక్స్టింగ్విషర్ అందుబాటులో ఉండాలి; దాని గేజ్ ఆకుపచ్చలో ఉండాలి.", "अग्निशामक यंत्र पहुंच में रखें और उसका गेज हरे निशान पर हो।"],
      ["Keep exits and passages clear at all times.", "నిష్క్రమణ మార్గాలు, దారులు ఎప్పుడూ ఖాళీగా ఉంచండి.", "निकास और रास्ते हमेशा खाली रखें।"],
      ["Close all gas valves at closing.", "మూసే సమయంలో అన్ని గ్యాస్ వాల్వ్‌లు మూయండి.", "बंद करते समय सभी गैस वाल्व बंद करें।"],
    ],
  },
];

export async function loadSampleSops(prisma: PrismaClient): Promise<{ total: number }> {
  for (const sop of SAMPLE_SOPS) {
    const text = (index: 0 | 1 | 2) => sop.steps.map((step) => step[index]).join("\n");
    const data = {
      category: sop.category,
      isPublished: true,
      title: { en: sop.title[0], te: sop.title[1], hi: sop.title[2] },
      body: { en: text(0), te: text(1), hi: text(2) },
    };
    await prisma.sopTemplate.upsert({ where: { code: sop.code }, create: { code: sop.code, ...data }, update: data });
  }
  return { total: SAMPLE_SOPS.length };
}
