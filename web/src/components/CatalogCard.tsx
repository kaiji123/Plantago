import { useEffect, useState } from "react";
import { api, num, usd, type Article, type CatalogItem } from "../api";
import CropIcon from "./CropIcon";

const FORM_LABEL = { food: "Food now", seed: "Seed to plant", tool: "Tool" } as const;
const range = (r?: [number, number], unit = "") => (r ? `${num(r[0], 1)}–${num(r[1], 1)}${unit}` : "—");
const tolerance = (t?: number) => (t == null ? null : t >= 0.75 ? "High" : t >= 0.5 ? "Medium" : "Low");

export default function CatalogCard({ item: i, picked, onToggle }: { item: CatalogItem; picked: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const toggle = () => i.available && onToggle();
  return (
    <>
      <div
        role="button"
        tabIndex={i.available ? 0 : -1}
        aria-pressed={picked}
        aria-disabled={!i.available}
        className={`crop ${picked ? "on" : ""} ${i.available ? "" : "off"}`}
        onClick={toggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())}
      >
        <div className="crop-top">
          <CropIcon cropId={i.cropId} form={i.form} big />
          <div>
            <div className="crop-name">{i.name}</div>
            <div className="crop-tags">
              <span className={`tag ${i.form}`}>{FORM_LABEL[i.form]}</span>
              {i.kind === "pulse" && <span className="tag protein">High protein</span>}
              {(i.droughtTolerance ?? 0) >= 0.75 && <span className="tag drought">Drought-hardy</span>}
            </div>
          </div>
          <span className="check" aria-hidden>{picked ? "✓" : "+"}</span>
        </div>
        <p className="crop-blurb">{i.blurb}</p>

        {i.available ? (
          <div className="crop-stats">
            {i.form === "food" && (
              <>
                <span><b>{i.mealsPerUsd}</b> meals/$ · <b>{usd(Math.round(i.deliveredCentsPerKg ?? 0))}</b>/kg delivered</span>
              </>
            )}
            {i.form === "seed" && (
              <>
                <span>1 kg seed → <b>~{i.seedMultiplier} kg</b> grain in a fair season</span>
                <span><b>{Math.round((i.successChance ?? 0) * 100)}%</b> harvest odds here · <b>~{num(i.expectedMealsPerUsd ?? 0)}</b> meals/$</span>
              </>
            )}
            {i.form === "tool" && (
              <>
                <span><b>{usd(Math.round(i.deliveredCentsPerKg ?? 0))}</b> per {i.unit} delivered</span>
                <span>~<b>{num(i.expectedMealsPerUnit ?? 0)}</b> meals per {i.unit} per season (rough estimate)</span>
              </>
            )}
            {i.growth?.growDays && i.form !== "tool" && (
              <span>
                🕒 Grows in <b>{range(i.growth.growDays)} days</b> · 💧 {range(i.growth.waterMm, " mm")}
              </span>
            )}
            <span className="origin">
              From {i.countries.join(", ")} · {i.growers} supplier{i.growers === 1 ? "" : "s"} · nearest {num(i.nearestKm ?? 0)} km
            </span>
          </div>
        ) : (
          <div className="crop-reason">Not available here: {i.reason}</div>
        )}
        <button
          type="button"
          className="learn"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          Growth facts & article →
        </button>
      </div>
      {open && <ArticleModal item={i} onClose={() => setOpen(false)} />}
    </>
  );
}

function ArticleModal({ item: i, onClose }: { item: CatalogItem; onClose: () => void }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.article(i.cropId).then(setArticle).catch(() => setFailed(true));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [i.cropId, onClose]);
  const g = i.growth;
  const wikiUrl = article?.url ?? (g ? `https://en.wikipedia.org/wiki/${g.wiki}` : undefined);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={i.name} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-head">
          {article?.thumbnail ? <img src={article.thumbnail} alt="" /> : <CropIcon cropId={i.cropId} form={i.form} big />}
          <div>
            <h2>{i.name}</h2>
            <p className="muted small">{i.blurb}</p>
          </div>
        </div>

        {i.form !== "tool" && g && (
          <>
            <h3>How it grows</h3>
            <table className="facts">
              <tbody>
                <tr><th>Time to harvest</th><td>{range(g.growDays, " days")}</td></tr>
                <tr><th>Water per season</th><td>{range(g.waterMm, " mm")}</td></tr>
                <tr><th>Typical smallholder yield</th><td>{range(g.yieldTPerHa, " t/ha")}</td></tr>
                <tr><th>Planted from</th><td>{g.propagation}</td></tr>
                {i.seedMultiplier ? <tr><th>Seed multiplier</th><td>1 kg seed → ~{i.seedMultiplier} kg grain</td></tr> : null}
                {tolerance(i.droughtTolerance) && <tr><th>Drought tolerance</th><td>{tolerance(i.droughtTolerance)}</td></tr>}
                {i.successChance != null && <tr><th>Harvest odds at this destination</th><td>{Math.round(i.successChance * 100)}% (risk-adjusted for climate)</td></tr>}
                {i.proteinGPerKg ? <tr><th>Protein</th><td>{i.proteinGPerKg} g per kg</td></tr> : null}
                {i.shelfLifeDays && i.form === "food" ? <tr><th>Keeps for</th><td>about {i.shelfLifeDays} days stored dry</td></tr> : null}
              </tbody>
            </table>
            <p className="muted small">Typical ranges for East African smallholder farms, rain-fed unless noted. Real results vary with rain, soil and care.</p>
          </>
        )}
        {i.form === "tool" && (
          <>
            <h3>What it does</h3>
            <table className="facts">
              <tbody>
                <tr><th>Expected impact</th><td>~{num(i.expectedMealsPerUnit ?? 0)} meals per {i.unit} per season</td></tr>
                <tr><th>Chance it pays off</th><td>{Math.round((i.reliability ?? 0) * 100)}% (needs water, training and use)</td></tr>
                <tr><th>Made in</th><td>{i.countries.join(", ")}</td></tr>
              </tbody>
            </table>
          </>
        )}

        <h3>From Wikipedia</h3>
        {article ? (
          <>
            <p className="article">{article.extract}</p>
            <p className="muted small">
              From the Wikipedia article <a href={article.url} target="_blank" rel="noreferrer">“{article.title}”</a>, available under{" "}
              <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">{article.license}</a>.
            </p>
          </>
        ) : failed ? (
          <p className="muted">Couldn't load the article. {wikiUrl && <a href={wikiUrl} target="_blank" rel="noreferrer">Read it on Wikipedia →</a>}</p>
        ) : (
          <p className="muted">Loading article…</p>
        )}
      </div>
    </div>
  );
}
