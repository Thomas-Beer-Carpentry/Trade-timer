export const newId = () => crypto.randomUUID();
export function createJob({ name, client, description = "" }) {
  return {
    id: newId(),
    name,
    client,
    description,
    createdAt: Date.now(),
    status: "active",
    gstBasisPoints: 1500,
    markup: { enabled: false, basisPoints: 1500, scope: "entire" },
    sessions: [],
    materials: [],
  };
}
export function previousRate(data, workerId) {
  const worker = data.workers.find((w) => w.id === workerId);
  const sessions = data.jobs
    .flatMap((j) => j.sessions)
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const session of sessions) {
    const saved = session.workers.find((w) => w.id === workerId);
    if (saved) return saved.rateCents;
  }
  return worker?.rateCents ?? 0;
}
