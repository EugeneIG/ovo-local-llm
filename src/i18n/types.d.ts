import "react-i18next";
import type ko from "../locales/ko.json";

declare module "react-i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof ko };
  }
}
