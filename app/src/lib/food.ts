/** The categories a kitchen actually thinks in, from the design system. */
export const FOODS = ["Prepared hot food", "Produce", "Bread & pastry", "Packaged"] as const;

export const DROP_WINDOWS = [
  "Tonight, 7-8pm",
  "Tonight, 8-9pm",
  "Tonight, 9-10pm",
  "Tonight, after 10pm",
] as const;

/** Rough conversion for the SB 1383 log. One serving is about 1.3 lb of food. */
export const LBS_PER_MEAL = 1.3;
