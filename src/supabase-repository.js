/** Storage boundary: auth.uid() determines ownership in SQL, never browser input. */
export class SupabaseRepository {
  constructor(client, userId = null) {
    this.client = client;
    this.userId = userId;
  }

  async _token() {
    const { data, error } = await this.client.auth.getSession();
    const session = data?.session;
    if (error || !session?.access_token || !session.user?.id)
      throw new Error("Sign in again before syncing your account.");
    if (this.userId !== null && session.user.id !== this.userId)
      throw new Error(
        "Account changed. Reopen the current account before syncing.",
      );
    this.userId ??= session.user.id;
    return session.access_token;
  }

  async fetch() {
    const token = await this._token();
    const { data, error } = await this.client
      .from("trade_timer_data")
      .select("payload,revision")
      .maybeSingle()
      .setHeader("Authorization", `Bearer ${token}`)
      .retry(false);
    if (error)
      throw new Error(error.message || "Cloud data could not be read.");
    return data === null
      ? null
      : { data: data.payload, revision: Number(data.revision) };
  }

  async write(data, expectedRevision) {
    const token = await this._token();
    // The session may change while Supabase awaits its shared token provider.
    // Pin the verified account's token to this request, rather than letting an
    // old account's queued write inherit the next account's credentials.
    const { data: saved, error } = await this.client
      .rpc("save_trade_timer", {
        expected_revision: expectedRevision,
        payload: data,
      })
      .setHeader("Authorization", `Bearer ${token}`)
      .retry(false);
    if (error)
      throw new Error(error.message || "Cloud changes could not be saved.");
    if (!Array.isArray(saved))
      throw new Error("Unexpected cloud save response.");
    if (saved.length === 0) return null;
    if (saved.length !== 1) throw new Error("Unexpected cloud save response.");
    return { data: saved[0].payload, revision: Number(saved[0].revision) };
  }
}
