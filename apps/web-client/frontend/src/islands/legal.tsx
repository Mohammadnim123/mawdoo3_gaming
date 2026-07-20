// Entry: mounts the legal-document reader (privacy / terms). Django renders
//   <div id="legal-island"></div>
//   <script id="legal-island-props" type="application/json">{"slug": "privacy"}</script>
// The active locale comes from <html lang> via the I18nProvider inside
// AppProviders — LegalPage resolves the bilingual document itself.
import { LegalPage } from "@/components/legal/LegalPage";
import type { LegalSlug } from "@/domain/legal/documents";
import { mountIsland } from "./lib/mount";

mountIsland("legal-island", (props: { slug?: LegalSlug }) => (
  <LegalPage slug={props.slug === "terms" ? "terms" : "privacy"} />
));
