import type { Role } from "../types";
import Button from "../components/Button";

/**
 * One question, asked once. The two sides of the product share a data model
 * and almost no screens, so this is a fork rather than a mode toggle.
 */

export default function RoleGate({ onPick }: { onPick: (r: Role) => void }) {
  return (
    <div className="rolegate">
      <div className="rolehead">
        <span className="lmark">
          Surplus <span className="larrow">→</span> Street
        </span>
        <h1 className="roletitle">Which are you tonight?</h1>
      </div>

      <button type="button" className="rolecard" onClick={() => onPick("restaurant")}>
        <span className="roleglyph" aria-hidden="true">◍</span>
        <span className="rolecard-title">I have food to give</span>
        <span className="rolecard-body">
          Post what is left at the end of service and when it can be collected. A
          volunteer comes and gets it. Your donation log writes itself.
        </span>
      </button>

      <button type="button" className="rolecard" onClick={() => onPick("volunteer")}>
        <span className="roleglyph" aria-hidden="true">◈</span>
        <span className="rolecard-title">I can drive</span>
        <span className="rolecard-body">
          Pick up surplus near you and decide which neighbourhood it goes to, using
          a map of what is still short tonight.
        </span>
      </button>

      <p className="fineprint rolefine">
        You can switch later from the Account tab. Nothing here asks for a login.
      </p>

      <div className="rolecta">
        <Button variant="quiet" size="md" fullWidth onClick={() => onPick("volunteer")}>
          Just show me the map
        </Button>
      </div>
    </div>
  );
}
