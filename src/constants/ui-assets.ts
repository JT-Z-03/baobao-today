export const UiAssets = {
  feeding: require('../../assets/ui/feeding.png'),
  poopLight: require('../../assets/ui/poop-light.png'),
  poopDark: require('../../assets/ui/poop-dark.png'),
  pee: require('../../assets/ui/pee.png'),
  sleep: require('../../assets/ui/sleep.png'),
  other: require('../../assets/ui/other.png'),
  milkVolume: require('../../assets/ui/milk-volume.png'),
  breastfeeding: require('../../assets/ui/breastfeeding.png'),
  brandFlower: require('../../assets/ui/brand-flower.png'),
  babySmile: require('../../assets/ui/baby-smile.png'),
  babySleeping: require('../../assets/ui/baby-sleeping.png'),
  happinessNote: require('../../assets/ui/happiness-note.png'),
} as const;

export type UiAssetName = keyof typeof UiAssets;
