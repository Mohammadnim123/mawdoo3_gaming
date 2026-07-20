// Entry: mounts the billing screen (reference app/account/billing/page.tsx)
// at /account/billing. BillingScreen reads ?checkout=success itself (fake
// provider landing → toast + cache refresh + query strip).
import { BillingScreen } from "@/components/account/BillingScreen";
import { mountIsland } from "./lib/mount";

mountIsland("billing-island", () => <BillingScreen />);
