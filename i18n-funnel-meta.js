// i18n-funnel-meta.js — localized <title> + meta description for the 8
// marketing funnel pages (homepage, for-employers, tracker,
// talent-pool, taylor, how-it-works, pricing, clarification), part of the
// 2026 5-language marketing site build. Pure data, no DB/network — consumed
// by _applyFunnelLocaleMeta() in server.js when a request carries a
// recognized ?lang= (es/fr/hi/zh). en is the existing server-rendered
// default for each page and is intentionally absent — it is never swapped.
// See CLAUDE.md's 5-language marketing site section for the whole design.
module.exports = {
  "home": {
    "es": {
      "title": "Personalización de currículum con IA que consigue entrevistas | ResumeTailored",
      "description": "La IA personaliza tu currículum para cada empleo y escribe una carta de presentación a juego en segundos. Palabras clave compatibles con ATS. Gratis para empezar, sin tarjeta de crédito."
    },
    "fr": {
      "title": "Personnalisation de CV par IA qui décroche des entretiens | ResumeTailored",
      "description": "L'IA réécrit votre CV pour chaque offre et rédige une lettre de motivation assortie en quelques secondes. Mots-clés compatibles ATS. Gratuit pour commencer, sans carte bancaire."
    },
    "hi": {
      "title": "AI रिज़्यूमे अनुकूलन जो इंटरव्यू दिलाए | ResumeTailored",
      "description": "AI हर जॉब के लिए आपका रिज़्यूमे फिर से लिखता है, और सेकंडों में मैचिंग कवर लेटर बनाता है। ATS-फ़्रेंडली कीवर्ड। फ़्री में शुरू करें, क्रेडिट कार्ड ज़रूरी नहीं।"
    },
    "zh": {
      "title": "AI简历定制，助你赢得面试机会 | ResumeTailored",
      "description": "AI根据每个职位重写你的简历，并在数秒内生成匹配的求职信。ATS友好关键词。免费开始，无需信用卡。"
    }
  },
  "forEmployers": {
    "es": {
      "title": "Para empleadores — Contrata más rápido con IA · ResumeTailored",
      "description": "Entra en el Portal para la evaluación de candidatos con IA, colaboración en equipo y un ecosistema Corporate completo de operaciones de personal. Planes desde $49/mes."
    },
    "fr": {
      "title": "Pour les employeurs — Recrutez plus vite avec l'IA · ResumeTailored",
      "description": "Accédez au Portail pour l'évaluation des candidats par IA, la collaboration en équipe et un écosystème Corporate complet de gestion RH. Forfaits à partir de 49 $/mois."
    },
    "hi": {
      "title": "नियोक्ताओं के लिए — AI से तेज़ हायरिंग · ResumeTailored",
      "description": "AI कैंडिडेट स्क्रीनिंग, टीम कोलैबोरेशन और पूरे Corporate पीपल-ऑपरेशंस इकोसिस्टम के लिए Portal में प्रवेश करें। $49/माह से शुरू होने वाले प्लान।"
    },
    "zh": {
      "title": "雇主专区 — 用AI更快招到人 · ResumeTailored",
      "description": "进入门户，体验AI候选人筛选、团队协作，以及完整的企业级人事运营生态系统。套餐起价每月$49。"
    }
  },
  "tracker": {
    "es": {
      "title": "Pipeline Tracker — Herramienta gratuita para candidatos | ResumeTailored",
      "description": "Deja de rastrear solicitudes en hojas de cálculo y capturas de pantalla. Guarda cualquier oferta, muévela por el pipeline y recibe recordatorios antes de que una oportunidad se enfríe. Gratis con cualquier cuenta de candidato."
    },
    "fr": {
      "title": "Suivi de candidatures — Outil gratuit pour candidats | ResumeTailored",
      "description": "Arrêtez de suivre vos candidatures dans des tableurs et des captures d'écran. Enregistrez une offre, faites-la avancer dans le pipeline et recevez un rappel avant qu'une opportunité ne s'éteigne. Gratuit avec tout compte candidat."
    },
    "hi": {
      "title": "पाइपलाइन ट्रैकर — फ़्री कैंडिडेट टूल | ResumeTailored",
      "description": "स्प्रेडशीट और स्क्रीनशॉट में एप्लिकेशन ट्रैक करना बंद करें। कोई भी पोस्टिंग सेव करें, पाइपलाइन में आगे बढ़ाएं, और मौका ठंडा होने से पहले रिमाइंडर पाएं। हर कैंडिडेट अकाउंट के लिए फ़्री।"
    },
    "zh": {
      "title": "求职管道追踪器 — 候选人免费工具 | ResumeTailored",
      "description": "别再用表格和截图追踪投递进度了。保存任意职位，在管道中推进，机会变冷之前收到提醒。所有候选人账户均可免费使用。"
    }
  },
  "talentPool": {
    "es": {
      "title": "Talent Pool — Que te encuentren los empleadores | ResumeTailored",
      "description": "Activa la opción una vez, controla exactamente qué ven los empleadores, y escucha solo de aquellos a los que no has rechazado. Gratis con cualquier cuenta de candidato."
    },
    "fr": {
      "title": "Talent Pool — Soyez repéré par les employeurs | ResumeTailored",
      "description": "Activez l'option une fois, contrôlez précisément ce que voient les employeurs, et n'entendez parler que de ceux que vous n'avez pas refusés. Gratuit avec tout compte candidat."
    },
    "hi": {
      "title": "टैलेंट पूल — नियोक्ताओं द्वारा खोजे जाएं | ResumeTailored",
      "description": "एक बार ऑप्ट इन करें, नियोक्ता क्या देख सकते हैं इसे पूरी तरह नियंत्रित करें, और केवल उन्हीं नियोक्ताओं से सुनें जिन्हें आपने अस्वीकार नहीं किया। हर कैंडिडेट अकाउंट के लिए फ़्री।"
    },
    "zh": {
      "title": "人才库 — 让雇主主动找到你 | ResumeTailored",
      "description": "一次性开启，精确控制雇主能看到的内容，只接收你未拒绝过的雇主的联系。所有候选人账户均可免费使用。"
    }
  },
  "taylor": {
    "es": {
      "title": "Conoce a Taylor — el asistente de contratación con IA | ResumeTailored para empleadores",
      "description": "Taylor es el asistente de contratación con IA dentro del Portal del empleador de ResumeTailored — publica empleos, clasifica candidatos, programa entrevistas y redacta mensajes, pero nada dirigido a los candidatos se envía sin tu aprobación. Descubre cómo funciona."
    },
    "fr": {
      "title": "Découvrez Taylor — l'assistant de recrutement par IA | ResumeTailored pour les employeurs",
      "description": "Taylor est l'assistant de recrutement par IA intégré au Portail employeur de ResumeTailored — il publie les offres, classe les candidats, planifie les entretiens et rédige les messages, mais rien destiné aux candidats n'est envoyé sans votre approbation. Découvrez comment il fonctionne."
    },
    "hi": {
      "title": "मिलें Taylor से — AI हायरिंग असिस्टेंट | नियोक्ताओं के लिए ResumeTailored",
      "description": "Taylor, ResumeTailored के एम्प्लॉयर पोर्टल के भीतर का AI हायरिंग असिस्टेंट है — यह जॉब पोस्ट करता है, कैंडिडेट्स को रैंक करता है, इंटरव्यू शेड्यूल करता है और मैसेज ड्राफ्ट करता है, लेकिन आपकी मंज़ूरी के बिना कैंडिडेट तक कुछ भी नहीं जाता। देखें यह कैसे काम करता है।"
    },
    "zh": {
      "title": "认识 Taylor —— AI招聘助手 | ResumeTailored 雇主版",
      "description": "Taylor 是 ResumeTailored 雇主门户内置的AI招聘助手——发布职位、为候选人排名、安排面试并草拟消息，但任何面向候选人的内容在未经你批准前都不会发出。了解它是如何运作的。"
    }
  },
  "howItWorks": {
    "es": {
      "title": "Cómo funciona — ResumeTailored AI",
      "description": "Descubre exactamente cómo ResumeTailored AI — un creador y personalizador de currículum con IA gratuito — reescribe tu currículum para cualquier oferta de empleo en 60 segundos usando Claude AI."
    },
    "fr": {
      "title": "Comment ça marche — ResumeTailored AI",
      "description": "Découvrez exactement comment ResumeTailored AI — un créateur et personnaliseur de CV par IA gratuit — réécrit votre CV pour n'importe quelle offre d'emploi en 60 secondes grâce à Claude AI."
    },
    "hi": {
      "title": "यह कैसे काम करता है — ResumeTailored AI",
      "description": "देखें कि ResumeTailored AI — एक फ़्री AI रिज़्यूमे बिल्डर और टेलर — Claude AI का उपयोग करके 60 सेकंड में किसी भी जॉब पोस्टिंग के लिए आपका रिज़्यूमे कैसे फिर से लिखता है।"
    },
    "zh": {
      "title": "使用方法 — ResumeTailored AI",
      "description": "了解 ResumeTailored AI——一款免费的AI简历生成与定制工具——如何借助 Claude AI，在60秒内为任意职位重写你的简历。"
    }
  },
  "pricing": {
    "es": {
      "title": "Precios — Gratis, Pro $19/mes, De por vida $129 y planes para empleadores | ResumeTailored AI",
      "description": "Precios de ResumeTailored AI: un plan gratuito genuinamente útil (personalización, cartas de presentación y escaneos ATS ilimitados), Pro a $19/mes o $129 de por vida, y planes para empleadores desde $0 hasta $299/mes."
    },
    "fr": {
      "title": "Tarifs — Gratuit, Pro 19 $/mois, À vie 129 $ et forfaits employeurs | ResumeTailored AI",
      "description": "Tarifs ResumeTailored AI : une offre gratuite vraiment utile (personnalisation, lettres de motivation et analyses ATS illimitées), Pro à 19 $/mois ou 129 $ à vie, et des forfaits employeurs de 0 $ à 299 $/mois."
    },
    "hi": {
      "title": "मूल्य-निर्धारण — फ़्री, Pro $19/माह, लाइफटाइम $129 और एम्प्लॉयर प्लान | ResumeTailored AI",
      "description": "ResumeTailored AI मूल्य-निर्धारण: एक सच में उपयोगी फ़्री प्लान (असीमित अनुकूलन, कवर लेटर और ATS स्कैन), Pro $19/माह या $129 लाइफटाइम पर, और $0 से $299/माह तक के एम्प्लॉयर प्लान।"
    },
    "zh": {
      "title": "价格 — 免费版、Pro每月$19、终身版$129及雇主套餐 | ResumeTailored AI",
      "description": "ResumeTailored AI 价格：真正实用的免费版（无限简历定制、求职信与ATS扫描）、每月$19或终身$129的Pro版，以及从$0到每月$299不等的雇主套餐。"
    }
  },
  "clarification": {
    "es": {
      "title": "Aclaración | ResumeTailored AI",
      "description": "Una breve aclaración sobre el nombre y los precios de ResumeTailored AI, para quien haya llegado aquí con dudas."
    },
    "fr": {
      "title": "Clarification | ResumeTailored AI",
      "description": "Une brève clarification sur le nom et les tarifs de ResumeTailored AI, pour toute personne arrivée ici en ayant des doutes."
    },
    "hi": {
      "title": "स्पष्टीकरण | ResumeTailored AI",
      "description": "ResumeTailored AI के नाम और मूल्य-निर्धारण के बारे में एक संक्षिप्त स्पष्टीकरण, उन सभी के लिए जो उलझन में यहां पहुंचे हैं।"
    },
    "zh": {
      "title": "说明 | ResumeTailored AI",
      "description": "关于 ResumeTailored AI 名称和定价的简要说明，写给任何因此感到困惑而来到这里的人。"
    }
  }
};
