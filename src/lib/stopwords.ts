// Function-word lists shared by the analysis engine and the corpus-wide
// aggregates. Used for the content/function split, keyword candidate
// filtering and the stopword flag in frequency tables.
const EN_STOP = new Set(
  ("a about above after again against all am an and any are aren as at be because been before being below between both but by can cannot could couldn did didn do does doesn doing don down during each few for from further had hadn has hasn have haven having he her here hers herself him himself his how i if in into is isn it its itself just ll me might more most must my myself no nor not now of off on once only or other our ours ourselves out over own re same shan she should shouldn so some such than that the their theirs them themselves then there these they this those through to too under until up ve very was wasn we were weren what when where which while who whom why will with won would wouldn you your yours yourself yourselves shall may might must upon also however thus therefore oh um uh erm hmm yeah yes okay right like mean know think said says say got get going wanna gonna kind sort thing things lot").split(
    " "
  )
);

const AR_STOP = new Set(
  "في من على إلى عن مع هذا هذه هذان ذلك تلك التي الذي الذين اللاتي أن إن لم لن ما لا قد كان كانت يكون تكون هو هي هم هن نحن أنا أنت يا كل بعض أي حيث كما أو ثم لكن حتى إذا حين بين عند لدى منذ سوف قد أه يعني آه إيه أه طب طيب بص خلاص تمام أوكي".split(
    " "
  )
);

export const STOPS: Record<"en" | "ar", Set<string>> = { en: EN_STOP, ar: AR_STOP };
