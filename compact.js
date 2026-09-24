// Compacte weergave — geen los aan/uit-knopje meer, dit is nu gewoon de
// vaste, standaard weergave van de lijst (items iets krapper op elkaar, zo
// past er meer op één scherm).
import { el } from "./dom.js";

if (el.list) el.list.classList.add("compact");
