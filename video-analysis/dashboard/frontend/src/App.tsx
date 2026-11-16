import { useEffect, useState } from "react";
import { fetchExperiments, fetchInsights, fetchMeta, fetchVideos } from "./api";
import { DataProvider, StateProvider, useDispatch, type Data } from "./state";
import css from "./App.module.css";
import { Header } from "./views/Header";
import { PredVsActual } from "./views/PredVsActual";
import { Projection } from "./views/Projection";

function Layout() {
  const dispatch = useDispatch();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "escape" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  return (
    <div className={css.app}>
      <Header />
      <main className={css.grid}>
        <div className={css.insights} />
        <div className={css.projection}>
          <Projection />
        </div>
        <div className={css.pva}>
          <PredVsActual />
        </div>
        <div className={css.clusters} />
        <div className={css.detail} />
        <div className={css.samples} />
        <div className={css.bottom} />
      </main>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([fetchMeta(), fetchVideos(), fetchInsights(), fetchExperiments().catch(() => null)])
      .then(([meta, videos, insights, experiments]) =>
        setData({ meta, videos, insights, experiments: experiments && experiments.length ? experiments : null, byId: new Map(videos.map((v) => [v.id, v])) }),
      )
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <div style={{ padding: 24 }}>Could not reach the API ({error}). Start it with: uvicorn app:app --port 8000 (in dashboard/backend).</div>;
  if (!data) return <div style={{ padding: 24 }}>Loading…</div>;
  return (
    <StateProvider>
      <DataProvider data={data}>
        <Layout />
      </DataProvider>
    </StateProvider>
  );
}
