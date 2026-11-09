import { useId, useState } from "react";
import { FAQ_ITEMS } from "./landingContent";

export default function FaqSection() {
  const baseId = useId().replace(/:/g, "");
  const [openId, setOpenId] = useState(FAQ_ITEMS[0]?.id ?? null);

  const toggle = (id) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <section className="lp-faq" id="faq" aria-labelledby="faq-title">
      <div className="lp-section-head lp-reveal">
        <h2 id="faq-title">Frequently asked questions</h2>
        <p>Clear answers for companies evaluating HRMS before they get started.</p>
      </div>

      <div className="lp-faq-list lp-reveal">
        {FAQ_ITEMS.map((item) => {
          const isOpen = openId === item.id;
          const panelId = `${baseId}-${item.id}-panel`;
          const buttonId = `${baseId}-${item.id}-button`;
          return (
            <div key={item.id} className={`lp-faq-item${isOpen ? " is-open" : ""}`}>
              <h3>
                <button
                  type="button"
                  id={buttonId}
                  className="lp-faq-trigger"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(item.id)}
                >
                  <span>{item.question}</span>
                  <span className="lp-faq-icon" aria-hidden="true" />
                </button>
              </h3>
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className="lp-faq-panel"
                aria-hidden={!isOpen}
                inert={!isOpen ? true : undefined}
              >
                <div className="lp-faq-panel-inner">
                  <p>{item.answer}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
