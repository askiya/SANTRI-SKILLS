'use strict';
// Santri Code — the AI Flow Studio chat of Santriverse inside VS Code / Antigravity.
// Login: browser PKCE handoff (client=code) → 127.0.0.1 callback → code-scoped session
// in SecretStorage. Chat, credits and limits are the website's, via /api/code/*.
const vscode = require('vscode');
const crypto = require('node:crypto');
const os = require('node:os');
const { createPkce, connectUrl } = require('./src/pkce');
const { startLoopback } = require('./src/loopback');
const { createClient, isAllowedBaseUrl } = require('./src/api');
const { followRun } = require('./src/chat-run');
const { thoughtView } = require('./src/progress');
const { Typewriter } = require('./src/typewriter');
const { parseDocuments, fileNameFor, draftDocument } = require('./src/documents');
const { createLogoResolver } = require('./src/logos');
const { formatContext, composeMessage, splitMessage, visibleEntry } = require('./src/context');

const TOKEN_KEY = 'santriCode.token';
const USER_KEY = 'santriCode.user';
const MODEL_KEY = 'santriCode.model';
const CONTEXT_KEY = 'santriCode.includeContext';
const LOGO_CACHE_KEY = 'santriCode.logoManifest';
const WRITTEN_KEY = 'santriCode.writtenDocuments'; // workspaceState: file uri → sha256 of what Santri Code wrote
// A bare approval ("ACC", "lanjut", …) must reach the server exactly as typed: it is how
// the AI Flow Studio recognises "generate the phase-3 document now".
const APPROVAL = /^\s*(acc|setuju|lanjut|lanjutkan|gas|oke|ok|yes|ya)\s*[.!]*\s*$/i;
const DEFAULTS = { siteUrl: 'https://santriverse.my.id', apiBaseUrl: 'https://api.santriverse.my.id/api' };

// Same starters as the website's ChatStudio.
const SUGGESTED = [
  { id: 'prd', title: 'PRD & Product Spec', desc: 'Mulai dari tujuan produk dan kebutuhan pengguna',
    prompt: 'Bantu discovery PRD. Tanyakan tujuan produk, pengguna, masalah, scope MVP dan batasan. Pisahkan fakta dari asumsi sebelum menyusun spesifikasi dan acceptance criteria.' },
  { id: 'architecture', title: 'System Architecture', desc: 'Petakan kebutuhan dan batasan sebelum memilih arsitektur',
    prompt: 'Bantu discovery arsitektur. Tanyakan kebutuhan, skala, tim, anggaran, keamanan dan stack saat ini. Bandingkan pilihan sederhana sebelum merekomendasikan arsitektur.' },
  { id: 'design', title: 'DESIGN.md Token System', desc: 'Buat DESIGN.md token system untuk design system',
    prompt: 'Mulai discovery DESIGN.md: tanyakan brand, pengguna, referensi visual, platform, aksesibilitas dan komponen sebelum merancang token warna, typography, spacing, elevasi dan radius.' },
  { id: 'sdlc', title: 'SDLC Lifecycle Plan', desc: 'Susun lifecycle plan dari discovery sampai maintenance',
    prompt: 'Mulai discovery SDLC: tanyakan scope, tim, tenggat, risiko, acceptance criteria, keamanan dan proses rilis sebelum menyusun roadmap dari discovery hingga maintenance.' },
];

// Line endings are not content: a CRLF copy of what we wrote is still ours.
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const sha256 = (text) => crypto.createHash('sha256').update(lf(text)).digest('hex');

function settings() {
  const config = vscode.workspace.getConfiguration('santriCode');
  const pick = (key) => {
    const value = String(config.get(key) || '').trim();
    return value && isAllowedBaseUrl(value) ? value.replace(/\/+$/, '') : DEFAULTS[key];
  };
  return { siteUrl: pick('siteUrl'), apiBaseUrl: pick('apiBaseUrl') };
}

/** Relative folder setting → safe path segments ('' = workspace root). */
function documentSegments(raw) {
  const value = String(raw || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!value) return [];
  const parts = value.split('/').filter(Boolean);
  if (/^[a-z]:/i.test(value) || parts.some((p) => p === '..' || p === '.')) return null;
  return parts;
}

class SantriCode {
  constructor(context) {
    this.context = context;
    this.webviews = new Set();
    this.loginFlow = null;
    this.runAbort = null;
    this.pendingPrefill = null;
    this.logoResolver = null;
    this.state = {
      phase: 'loading',
      appName: vscode.env.appName,
      user: context.globalState.get(USER_KEY) || null,
      models: [],
      modelId: context.globalState.get(MODEL_KEY) || null,
      usage: null,
      includeContext: context.globalState.get(CONTEXT_KEY, false),
      chats: [],
      chatId: null,
      messages: [],
      pending: null,
      loadingChat: false,
      error: null,
      notice: null,
      saved: {}, // document ref → workspace-relative path written for it
      suggested: SUGGESTED,
    };
    this.savedUris = new Map();
    this.contextSent = new Set(); // chats whose first message already carried the project context
    this.live = null; // the document being typed into the editor while the AI writes it
    this.liveStarting = null;
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.status.command = 'santriCode.focus';
    context.subscriptions.push(this.status);
    this.updateStatus();
    this.status.show();
  }

  // ── plumbing ────────────────────────────────────────────────
  api() {
    const { apiBaseUrl } = settings();
    return createClient({ baseUrl: apiBaseUrl, getToken: () => this.context.secrets.get(TOKEN_KEY), version: this.context.extension?.packageJSON?.version });
  }

  setState(patch) {
    Object.assign(this.state, patch);
    this.updateStatus();
    const message = { type: 'state', state: this.state };
    for (const webview of this.webviews) webview.postMessage(message).then(undefined, () => {});
  }

  updateStatus() {
    const { phase, usage } = this.state;
    if (phase === 'ready' && usage && !usage.unlimited && usage.limit != null) {
      this.status.text = `$(sparkle) Santri ${usage.remaining}/${usage.limit}`;
      this.status.tooltip = `Santri Code · ${usage.remaining} dari ${usage.limit} kredit AI tersisa hari ini
Klik (atau Ctrl+Shift+Alt+S) untuk membuka panel`;
    } else {
      this.status.text = '$(sparkle) Santri Code';
      this.status.tooltip = `${phase === 'ready' ? 'Santri Code · AI Flow Studio' : 'Santri Code · login untuk mulai'}
Klik (atau Ctrl+Shift+Alt+S) untuk membuka panel`;
    }
  }

  attach(webview, disposables) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const { siteUrl, apiBaseUrl } = settings();
    const origins = [...new Set([new URL(siteUrl).origin, new URL(apiBaseUrl).origin, 'https://cdn.simpleicons.org'])].join(' ');
    const nonce = crypto.randomBytes(16).toString('base64');
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    const uri = (file) => webview.asWebviewUri(vscode.Uri.joinPath(media, file));
    webview.html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} ${origins} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${uri('main.css')}"><title>Santri Code</title></head>
<body data-logo="${uri('icon.png')}"><div id="app"></div>
<script nonce="${nonce}" src="${uri('markdown.js')}"></script><script nonce="${nonce}" src="${uri('main.js')}"></script></body></html>`;
    this.webviews.add(webview);
    disposables.push(webview.onDidReceiveMessage((msg) => this.onMessage(webview, msg).catch((error) => this.fail(error))));
    disposables.push({ dispose: () => this.webviews.delete(webview) });
  }

  async onMessage(webview, msg) {
    switch (msg?.type) {
      case 'ready':
        webview.postMessage({ type: 'state', state: this.state });
        if (this.pendingPrefill) {
          webview.postMessage({ type: 'prefill', text: this.pendingPrefill });
          this.pendingPrefill = null;
        }
        if (this.state.phase === 'loading' || this.state.phase === 'signedOut') await this.refreshAll();
        return;
      case 'login': return this.login();
      case 'reopenLogin': return this.loginFlow && vscode.env.openExternal(vscode.Uri.parse(this.loginFlow.url));
      case 'cancelLogin': this.loginFlow?.close(); return;
      case 'upgrade': return vscode.env.openExternal(vscode.Uri.parse(`${settings().siteUrl}/checkout`));
      case 'dismiss': return this.setState({ error: null, notice: null });
      case 'send': return this.send(String(msg.text || ''));
      case 'cancel': return this.cancel();
      case 'newChat': return this.newChat();
      case 'openChat': return this.openChat(String(msg.id || ''));
      case 'loadChats': return this.loadChats();
      case 'selectModel': return this.selectModel(String(msg.id || ''));
      case 'toggleContext':
        await this.context.globalState.update(CONTEXT_KEY, !this.state.includeContext);
        // Switching it on again means "send the (fresh) context with my next message".
        if (!this.state.includeContext && this.state.chatId) this.contextSent.delete(this.state.chatId);
        return this.setState({ includeContext: !this.state.includeContext });
      case 'saveDoc': return this.saveDocument(this.documentByRef(msg.ref), String(msg.ref || ''));
      case 'openSaved': {
        const uri = this.savedUris.get(String(msg.ref || ''));
        return uri && vscode.window.showTextDocument(uri, { preview: false });
      }
      case 'openDoc': return this.openDocument(this.documentByRef(msg.ref));
      case 'copyDoc': {
        const doc = this.documentByRef(msg.ref);
        if (doc) await vscode.env.clipboard.writeText(doc.content);
        return doc && vscode.window.setStatusBarMessage('Dokumen disalin', 2000);
      }
      case 'copy': return vscode.env.clipboard.writeText(String(msg.text || ''));
      case 'openExternal': {
        const url = String(msg.url || '');
        if (/^https?:\/\//i.test(url)) return vscode.env.openExternal(vscode.Uri.parse(url));
        return undefined;
      }
      default: return undefined;
    }
  }

  fail(error, { reloadChat = false } = {}) {
    if (error?.name === 'AbortError') return;
    if (error?.status === 401) return this.signOut('Sesi Santri Code berakhir. Login ulang ke Santriverse.');
    if (error?.code === 'premium_required' || (error?.status === 403 && /premium/i.test(error.message))) {
      return this.setState({ phase: 'premium', error: error.message, pending: null });
    }
    this.setState({ error: error?.message || String(error) });
    if (reloadChat && this.state.chatId) this.openChat(this.state.chatId, { quiet: true }).catch(() => {});
    return undefined;
  }

  // ── auth ────────────────────────────────────────────────────
  async login() {
    if (this.loginFlow) return vscode.env.openExternal(vscode.Uri.parse(this.loginFlow.url));
    const { siteUrl } = settings();
    const api = this.api();
    const { verifier, challenge, state } = createPkce();
    const extId = this.context.extension?.id || 'santriverse.santri-code';
    const flow = await startLoopback({
      state,
      appName: vscode.env.appName,
      returnUrl: `${vscode.env.uriScheme}://${extId}/connected`,
      exchange: (ticket) => api.exchange(ticket, verifier),
    });
    this.loginFlow = { ...flow, url: connectUrl(siteUrl, { port: flow.port, state, challenge }) };
    this.setState({ phase: 'waitingLogin', error: null, notice: null });
    await vscode.env.openExternal(vscode.Uri.parse(this.loginFlow.url));
    try {
      const session = await flow.result;
      if (!session?.token) throw new Error('Server tidak mengembalikan sesi.');
      await this.context.secrets.store(TOKEN_KEY, session.token);
      await this.context.globalState.update(USER_KEY, session.user || null);
      this.setState({ user: session.user || null });
      vscode.window.showInformationMessage(`Santri Code terhubung${session.user?.name ? ` sebagai ${session.user.name}` : ''}.`);
      await this.refreshAll();
    } catch (error) {
      if (error?.code === 'login_cancelled') this.setState({ phase: 'signedOut' });
      else if (error?.code === 'premium_required' || error?.status === 403) this.setState({ phase: 'premium', error: error.message });
      else this.setState({ phase: 'signedOut', error: error?.message || 'Login gagal.' });
    } finally {
      this.loginFlow = null;
    }
    return undefined;
  }

  async logout() {
    this.runAbort?.abort();
    if (await this.context.secrets.get(TOKEN_KEY)) await this.api().logout().catch(() => {});
    await this.signOut('Kamu sudah keluar dari Santri Code.');
  }

  async signOut(notice) {
    this.runAbort?.abort();
    await this.context.secrets.delete(TOKEN_KEY);
    await this.context.globalState.update(USER_KEY, null);
    this.setState({ phase: 'signedOut', user: null, models: [], usage: null, chats: [], chatId: null, messages: [], pending: null, error: null, notice });
  }

  // ── data ────────────────────────────────────────────────────
  async resolver() {
    if (this.logoResolver) return this.logoResolver;
    const { siteUrl, apiBaseUrl } = settings();
    let assets = this.context.globalState.get(LOGO_CACHE_KEY) || [];
    try {
      const response = await fetch(`${siteUrl}/ai-logos/lobehub-manifest.json`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (response.ok) {
        const manifest = await response.json();
        if (Array.isArray(manifest?.assets)) {
          assets = manifest.assets.map((a) => ({ key: a.key, file: a.file }));
          await this.context.globalState.update(LOGO_CACHE_KEY, assets);
        }
      }
    } catch { /* logos are decoration; keep the cached copy */ }
    this.logoResolver = createLogoResolver({ siteUrl, apiBaseUrl, assets });
    return this.logoResolver;
  }

  static usageOf(raw) {
    if (!raw) return null;
    return {
      used: raw.credits_used ?? 0,
      limit: raw.credits_limit ?? null,
      remaining: raw.credits_remaining ?? null,
      unlimited: !!raw.credits_unlimited,
      resetsAt: raw.resets_at || null,
    };
  }

  /** One refresh at a time: activation and the first panel both ask for it. */
  refreshAll() {
    if (!this.refreshing) this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async doRefresh() {
    if (!(await this.context.secrets.get(TOKEN_KEY))) return this.setState({ phase: 'signedOut' });
    if (this.state.phase !== 'ready') this.setState({ phase: 'loading' });
    try {
      const [boot, logo] = await Promise.all([this.api().bootstrap(), this.resolver()]);
      const models = (boot.models || []).map((m) => ({
        id: m.id,
        name: m.display_name,
        providerModelId: m.provider_model_id,
        provider: m.provider_display_name || m.provider,
        credits: m.credits_per_run,
        isDefault: !!m.is_default,
        logo: logo(m),
      }));
      const keep = models.find((m) => m.id === this.state.modelId);
      const modelId = keep ? keep.id : (models.find((m) => m.isDefault) || models[0])?.id || null;
      const user = { ...(this.state.user || {}), name: boot.profile?.name || this.state.user?.name, avatar: boot.profile?.avatar || null };
      this.setState({ phase: 'ready', models, modelId, usage: SantriCode.usageOf(boot.usage), user, error: null });
      await this.loadChats();
    } catch (error) {
      if (error?.status === 401 || error?.code === 'premium_required') return this.fail(error);
      this.setState({ phase: this.state.phase === 'ready' ? 'ready' : 'signedOut', error: error?.message || 'Gagal memuat Santri Code.' });
    }
    return undefined;
  }

  async refreshUsage() {
    try {
      const { usage } = await this.api().usage();
      this.setState({ usage: SantriCode.usageOf(usage) });
    } catch (error) {
      if (error?.status === 401) this.fail(error);
    }
  }

  async loadChats() {
    try {
      const { conversations } = await this.api().chats();
      this.setState({ chats: (conversations || []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at })) });
    } catch (error) {
      this.fail(error);
    }
  }

  async selectModel(id) {
    if (!this.state.models.some((m) => m.id === id)) return;
    await this.context.globalState.update(MODEL_KEY, id);
    this.setState({ modelId: id });
  }

  renderMessage(m) {
    if (m.role === 'user') {
      const { text, hasContext } = splitMessage(m.content);
      return { id: m.id, role: 'user', text, hasContext };
    }
    let index = 0;
    const segments = parseDocuments(m.content).segments.map((s) => (s.type === 'document'
      ? { type: 'document', index: index++, title: s.document.metadata.title, kind: s.document.metadata.kind, version: s.document.metadata.version, fileName: fileNameFor(s.document.metadata), content: s.document.content }
      : { type: 'text', content: s.content, literal: !!s.literal }));
    return { id: m.id, role: 'assistant', model: m.model || null, latencyMs: Number.isFinite(m.latency_ms) ? m.latency_ms : null, segments };
  }

  documentByRef(ref) {
    const at = String(ref || '').lastIndexOf(':');
    if (at < 0) return null;
    const id = String(ref).slice(0, at);
    const index = Number(String(ref).slice(at + 1));
    const message = this.state.messages.find((m) => String(m.id) === id);
    const doc = message?.segments?.find((s) => s.type === 'document' && s.index === index);
    return doc ? { metadata: { title: doc.title, kind: doc.kind, version: doc.version }, content: doc.content } : null;
  }

  newChat() {
    this.runAbort?.abort();
    this.setState({ chatId: null, messages: [], pending: null, loadingChat: false, error: null, notice: null });
  }

  async openChat(id, { quiet = false } = {}) {
    if (!id) return;
    if (id !== this.state.chatId) this.runAbort?.abort();
    if (!quiet) this.setState({ chatId: id, messages: [], pending: null, loadingChat: true, error: null, notice: null });
    try {
      const { conversation, pending_run: pendingRun } = await this.api().chat(id);
      if (this.state.chatId !== id) return;
      const messages = (conversation.messages || []).map((m) => this.renderMessage(m));
      if (messages.some((m) => m.hasContext)) this.contextSent.add(id);
      this.setState({ messages, loadingChat: false });
      if (pendingRun && ['queued', 'running'].includes(pendingRun.status) && !this.state.pending) {
        const { text, hasContext } = splitMessage(pendingRun.message || '');
        this.setState({
          messages: [...messages, { id: `opt-${pendingRun.idempotency_key}`, role: 'user', text, hasContext }],
          pending: { key: pendingRun.idempotency_key, chatId: id, prompt: text, ...thoughtView({ run: pendingRun }, text), draft: null, startedAt: Date.parse(pendingRun.created_at) || Date.now() },
        });
        await this.follow(id, pendingRun.idempotency_key, null, true);
      }
    } catch (error) {
      if (this.state.chatId === id) this.setState({ loadingChat: false });
      this.fail(error);
    }
  }

  // ── chat ────────────────────────────────────────────────────
  async collectContext() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return '';
    const fs = vscode.workspace.fs;
    const read = async (uri, max) => {
      try {
        const bytes = await fs.readFile(uri);
        return Buffer.from(bytes).subarray(0, max).toString('utf8');
      } catch { return null; }
    };
    const tree = [];
    try {
      const root = (await fs.readDirectory(folder.uri)).filter(([name]) => visibleEntry(name))
        .sort((a, b) => (b[1] & vscode.FileType.Directory) - (a[1] & vscode.FileType.Directory) || a[0].localeCompare(b[0]));
      for (const [name, type] of root.slice(0, 60)) {
        const isDir = (type & vscode.FileType.Directory) !== 0;
        tree.push(isDir ? `${name}/` : name);
        if (!isDir || tree.length > 110) continue;
        const children = (await fs.readDirectory(vscode.Uri.joinPath(folder.uri, name)).then((x) => x, () => []))
          .filter(([child]) => visibleEntry(child)).slice(0, 15);
        for (const [child, childType] of children) tree.push(`${name}/${child}${(childType & vscode.FileType.Directory) ? '/' : ''}`);
      }
    } catch { /* unreadable root: send what we have */ }
    const manifests = {};
    for (const file of ['package.json', 'composer.json', 'pyproject.toml', 'go.mod', 'pubspec.yaml', 'Cargo.toml']) {
      const raw = await read(vscode.Uri.joinPath(folder.uri, file), 20000);
      if (raw) manifests[file] = raw;
    }
    let readme = '';
    for (const file of ['README.md', 'readme.md', 'Readme.md']) {
      readme = (await read(vscode.Uri.joinPath(folder.uri, file), 4000)) || '';
      if (readme) break;
    }
    const active = vscode.window.activeTextEditor?.document;
    const activeFile = active && vscode.workspace.getWorkspaceFolder(active.uri)?.uri.toString() === folder.uri.toString()
      && visibleEntry(active.uri.path.split('/').pop()) ? vscode.workspace.asRelativePath(active.uri, false) : '';
    return formatContext({ name: folder.name, tree, manifests, readme, activeFile });
  }

  async send(rawText) {
    const text = rawText.trim();
    if (!text || this.state.pending || this.state.phase !== 'ready') return;
    const modelId = this.state.modelId;
    if (!modelId) return this.setState({ error: 'Belum ada model aktif. Hubungi admin Santriverse.' });
    const api = this.api();
    // Context goes once per chat, never on an approval: it would hide "ACC" from the
    // server and repeat thousands of characters in every turn of the history.
    const attach = this.state.includeContext && !APPROVAL.test(text) && !(this.state.chatId && this.contextSent.has(this.state.chatId));
    const context = attach ? await this.collectContext() : '';
    const message = composeMessage(text, context);
    const key = `ide-${crypto.randomUUID()}`;
    let chatId = this.state.chatId;
    this.setState({ error: null, notice: null });
    try {
      if (!chatId) {
        const { conversation } = await api.createChat({ title: text.replace(/\s+/g, ' ').slice(0, 80), model_config_id: modelId });
        chatId = conversation.id;
        this.setState({ chatId, messages: [] });
      }
      if (context) this.contextSent.add(chatId);
      this.setState({
        messages: [...this.state.messages, { id: `opt-${key}`, role: 'user', text, hasContext: !!context }],
        pending: { key, chatId, prompt: text, ...thoughtView(null, text), draft: null, startedAt: Date.now() },
      });
      await this.follow(chatId, key, { message, model_config_id: modelId }, false);
    } catch (error) {
      if (this.state.chatId === chatId) this.setState({ pending: null });
      this.fail(error, { reloadChat: true });
    }
    return undefined;
  }

  async follow(chatId, key, body, accepted) {
    const controller = new AbortController();
    this.runAbort = controller;
    try {
      const data = await followRun({
        client: this.api(),
        chatId,
        key,
        body,
        accepted,
        signal: controller.signal,
        onUpdate: (update) => {
          if (update.document_draft) this.liveDraft(key, update.document_draft);
          if (this.state.chatId !== chatId || this.state.pending?.key !== key) return;
          this.setState({ pending: { ...this.state.pending, ...thoughtView(update, this.state.pending.prompt), draft: update.document_draft ? draftDocument(update.document_draft) : null } });
        },
      });
      const done = [data.user_message, data.assistant_message].filter(Boolean).map((m) => this.renderMessage(m));
      if (this.state.chatId === chatId) {
        const ids = new Set([`opt-${key}`, ...done.map((m) => String(m.id))]);
        this.setState({ messages: [...this.state.messages.filter((m) => !ids.has(String(m.id))), ...done], pending: null });
      }
      const answer = done.find((m) => m.role === 'assistant');
      if (answer) await this.autoSaveDocuments(answer, key);
      else await this.discardLive();
      this.refreshUsage();
      this.loadChats();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (this.state.chatId === chatId) this.setState({ pending: null });
      await this.discardLive();
      if (error?.code === 'CHAT_RUN_CANCELLED') {
        this.setState({ notice: 'Dihentikan. Kredit untuk pesan ini dikembalikan.' });
        if (this.state.chatId === chatId) this.openChat(chatId, { quiet: true });
        this.refreshUsage();
        return;
      }
      this.fail(error, { reloadChat: this.state.chatId === chatId });
      this.refreshUsage();
    } finally {
      if (this.runAbort === controller) this.runAbort = null;
    }
  }

  async cancel() {
    const pending = this.state.pending;
    if (!pending) return;
    try {
      await this.api().cancel(pending.chatId, pending.key);
    } catch (error) {
      if (error?.status !== 409) this.fail(error);
    }
  }

  // ── documents ───────────────────────────────────────────────
  /** Target folder inside a workspace folder, honouring santriCode.documentsFolder. */
  documentsDir(folder) {
    const segments = documentSegments(vscode.workspace.getConfiguration('santriCode', folder.uri).get('documentsFolder'));
    if (segments === null) {
      vscode.window.showWarningMessage('Setting santriCode.documentsFolder harus folder relatif di dalam workspace. Dokumen disimpan di root workspace.');
    }
    return segments?.length ? vscode.Uri.joinPath(folder.uri, ...segments) : folder.uri;
  }

  async readText(uri) {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return null;
    }
  }

  async nextFreeName(dir, fileName) {
    const stem = fileName.replace(/\.md$/i, '');
    for (let n = 2; n < 100; n++) {
      const candidate = vscode.Uri.joinPath(dir, `${stem}-${n}.md`);
      if ((await this.readText(candidate)) === null) return candidate;
    }
    return vscode.Uri.joinPath(dir, `${stem}-${Date.now()}.md`);
  }

  async remember(ref, uri, content) {
    const written = { ...this.context.workspaceState.get(WRITTEN_KEY, {}) };
    written[uri.toString()] = sha256(content);
    await this.context.workspaceState.update(WRITTEN_KEY, written);
    if (ref) {
      this.savedUris.set(ref, uri);
      this.setState({ saved: { ...this.state.saved, [ref]: vscode.workspace.asRelativePath(uri, false) } });
    }
  }

  docSettings(folder) {
    const config = vscode.workspace.getConfiguration('santriCode', folder.uri);
    return { autoSave: config.get('autoSaveDocuments', true), typing: config.get('typingAnimation', true) };
  }

  /**
   * Where a document goes. A file Santri Code wrote and the member has not touched is
   * reused; anything else (edited since, unsaved changes, their own file) is never
   * overwritten — the document goes next to it as NAME-n.md. `content` null = unknown yet.
   */
  async resolveTarget(folder, fileName, content) {
    const dir = this.documentsDir(folder);
    let target = vscode.Uri.joinPath(dir, fileName);
    const existing = await this.readText(target);
    const ours = this.context.workspaceState.get(WRITTEN_KEY, {})[target.toString()];
    const dirty = (vscode.workspace.textDocuments || []).some((d) => d.uri.toString() === target.toString() && d.isDirty);
    if (existing !== null && (content === null || lf(existing) !== lf(content)) && (dirty || ours !== sha256(existing))) {
      target = await this.nextFreeName(dir, fileName);
      return { dir, target, existing: null, renamed: true };
    }
    return { dir, target, existing, renamed: false };
  }

  /** Opens `target` beside the chat and returns a typewriter that types into it. */
  async openLive(dir, target, existing, key, kind) {
    await vscode.workspace.fs.createDirectory(dir);
    if (existing === null) {
      await vscode.workspace.fs.writeFile(target, new Uint8Array());
      await this.remember(null, target, '');
    }
    const doc = await vscode.workspace.openTextDocument(target);
    const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    // Windows editors default new files to CRLF and turn every typed "\n" into "\r\n".
    // Markdown documents are LF; switching first keeps the typed text and the file identical.
    if (doc.eol === vscode.EndOfLine?.CRLF && editor?.edit) {
      await editor.edit((builder) => builder.setEndOfLine(vscode.EndOfLine.LF)).then(undefined, () => false);
    }
    const live = { key, kind, uri: target, doc, original: existing, created: existing === null };
    /** Document offset of an offset in the LF text (identical unless the file kept CRLF). */
    const docOffset = (n) => {
      const text = doc.getText();
      if (!text.includes('\r')) return n;
      let i = 0;
      for (let k = 0; k < n && i < text.length; k++) i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
      return i;
    };
    let lastReveal = 0;
    live.writer = new Typewriter({
      initial: lf(doc.getText()),
      write: async (op) => {
        // The member typed into the file or closed it: stop typing there, never fight them.
        if (doc.isClosed || lf(doc.getText()) !== live.writer.written) return false;
        const edit = new vscode.WorkspaceEdit();
        const end = doc.positionAt(doc.getText().length);
        if (op.type === 'append') edit.insert(target, end, op.text);
        else edit.delete(target, new vscode.Range(doc.positionAt(docOffset(op.offset)), end));
        if (!(await vscode.workspace.applyEdit(edit))) return false;
        if (Date.now() - lastReveal > 150) {
          lastReveal = Date.now();
          const tail = doc.positionAt(doc.getText().length);
          for (const editor of vscode.window.visibleTextEditors || []) {
            if (editor.document.uri.toString() === target.toString()) editor.revealRange(new vscode.Range(tail, tail), vscode.TextEditorRevealType.Default);
          }
        }
        return true;
      },
    });
    return live;
  }

  /** A document draft streamed in: create its file once, then keep typing the new text. */
  liveDraft(key, draft) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const view = draftDocument(draft);
    if (!folder || !view) return;
    const { autoSave, typing } = this.docSettings(folder);
    if (!autoSave || !typing) return;
    this.liveText = view.content;
    if (this.live?.key === key) {
      this.live.writer.setTarget(view.content);
      return;
    }
    if (this.liveStarting) return;
    this.liveStarting = (async () => {
      const { dir, target, existing } = await this.resolveTarget(folder, fileNameFor(view.metadata), null);
      const live = await this.openLive(dir, target, existing, key, draft.kind);
      this.live = live;
      live.writer.setTarget(this.liveText);
    })().catch(() => {}).finally(() => { this.liveStarting = null; });
  }

  /** The run failed or was cancelled: put the file back as it was. */
  async discardLive() {
    await this.liveStarting;
    const live = this.live;
    this.live = null;
    if (!live) return;
    live.writer.stop();
    try {
      if (!live.doc.isClosed && lf(live.doc.getText()) === live.writer.written) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(live.uri, new vscode.Range(live.doc.positionAt(0), live.doc.positionAt(live.doc.getText().length)), live.original ?? '');
        await vscode.workspace.applyEdit(edit);
        await live.doc.save();
        if (live.created) await vscode.workspace.fs.delete(live.uri);
      }
    } catch { /* leave the file for the member to inspect */ }
  }

  /**
   * Finished documents land in the project by themselves, like an agent writing files:
   * typed into the editor (the live file when the AI was already writing it), then saved.
   */
  async autoSaveDocuments(message, key = null) {
    await this.liveStarting;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const live = this.live && this.live.key === key ? this.live : null;
    this.live = null;
    const settingsNow = folder ? this.docSettings(folder) : { autoSave: false };
    const documents = (message.segments || []).filter((s) => s.type === 'document');
    if (!folder || !settingsNow.autoSave || !documents.length) {
      if (live) { this.live = live; await this.discardLive(); }
      return;
    }
    let liveUsed = false;
    for (const segment of documents) {
      const ref = `${message.id}:${segment.index}`;
      const content = segment.content.endsWith('\n') ? segment.content : `${segment.content}\n`;
      try {
        let saved = null;
        if (live && !liveUsed && (live.kind === segment.kind || documents.length === 1)) {
          liveUsed = true;
          if (await live.writer.finish(content)) {
            await live.doc.save();
            saved = { target: live.uri, renamed: false };
          }
        }
        if (!saved) saved = await this.writeDocument(folder, segment.fileName, segment.kind, content, settingsNow.typing);
        await this.remember(ref, saved.target, content);
        const where = vscode.workspace.asRelativePath(saved.target, false);
        if (saved.renamed) vscode.window.showInformationMessage(`${segment.fileName} sudah kamu ubah, jadi versi baru disimpan sebagai ${where}.`);
        else vscode.window.setStatusBarMessage(`$(check) Santri Code menyimpan ${where}`, 4000);
      } catch (error) {
        this.setState({ error: `Gagal menyimpan ${segment.fileName} otomatis: ${error?.message || error}. Pakai tombol Simpan.` });
      }
    }
    if (live && !liveUsed) { this.live = live; await this.discardLive(); }
  }

  /** Writes one finished document (typed when the animation is on) and returns where it went. */
  async writeDocument(folder, fileName, kind, content, typing) {
    let { dir, target, existing, renamed } = await this.resolveTarget(folder, fileName, content);
    if (existing !== null && lf(existing) === lf(content)) {
      await vscode.window.showTextDocument(target, { preview: false, preserveFocus: true });
      return { target, renamed };
    }
    if (typing) {
      const live = await this.openLive(dir, target, existing, null, kind);
      if (await live.writer.finish(content)) {
        await live.doc.save();
        return { target, renamed };
      }
      target = await this.nextFreeName(dir, fileName); // member typed into it meanwhile
      renamed = true;
    }
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    await vscode.window.showTextDocument(target, { preview: false, preserveFocus: true });
    return { target, renamed };
  }

  async saveDocument(doc, ref = '') {
    if (!doc) return;
    const content = doc.content.endsWith('\n') ? doc.content : `${doc.content}\n`;
    const fileName = fileNameFor(doc.metadata);
    const folders = vscode.workspace.workspaceFolders || [];
    let target;
    if (!folders.length) {
      target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(`${os.homedir()}/${fileName}`), filters: { Markdown: ['md'] }, saveLabel: 'Simpan dokumen' });
      if (!target) return;
    } else {
      const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Simpan dokumen ke folder workspace mana?' });
      if (!folder) return;
      const dir = this.documentsDir(folder);
      target = vscode.Uri.joinPath(dir, fileName);
      if ((await this.readText(target)) !== null) {
        const choice = await vscode.window.showWarningMessage(`${vscode.workspace.asRelativePath(target)} sudah ada.`, { modal: true }, 'Timpa', 'Simpan sebagai file baru');
        if (!choice) return;
        if (choice !== 'Timpa') target = await this.nextFreeName(dir, fileName);
      }
      await vscode.workspace.fs.createDirectory(dir);
    }
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    await this.remember(ref, target, content);
    await vscode.window.showTextDocument(target, { preview: false });
    vscode.window.showInformationMessage(`Tersimpan: ${vscode.workspace.asRelativePath(target)}`);
  }

  async openDocument(doc) {
    if (!doc) return;
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: doc.content });
    await vscode.window.showTextDocument(document, { preview: false });
  }

  prefill(text) {
    if (!this.webviews.size) this.pendingPrefill = text;
    for (const webview of this.webviews) webview.postMessage({ type: 'prefill', text });
  }
}

function activate(context) {
  const app = new SantriCode(context);
  const viewDisposables = [];

  context.subscriptions.push(vscode.window.registerWebviewViewProvider('santriCode.chat', {
    resolveWebviewView(view) {
      app.attach(view.webview, viewDisposables);
      view.onDidDispose(() => viewDisposables.splice(0).forEach((d) => d.dispose()));
    },
  }, { webviewOptions: { retainContextWhenHidden: true } }));

  const focus = () => vscode.commands.executeCommand('santriCode.chat.focus');
  const start = (id) => async () => {
    await focus();
    app.prefill(SUGGESTED.find((s) => s.id === id).prompt);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('santriCode.focus', focus),
    vscode.commands.registerCommand('santriCode.openPanel', () => {
      const panel = vscode.window.createWebviewPanel('santriCode.panel', 'Santri Code', vscode.ViewColumn.Beside, { retainContextWhenHidden: true });
      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
      const disposables = [];
      app.attach(panel.webview, disposables);
      panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
    }),
    vscode.commands.registerCommand('santriCode.newChat', async () => { await focus(); app.newChat(); }),
    vscode.commands.registerCommand('santriCode.login', async () => { await focus(); await app.login(); }),
    vscode.commands.registerCommand('santriCode.logout', () => app.logout()),
    vscode.commands.registerCommand('santriCode.startPrd', start('prd')),
    vscode.commands.registerCommand('santriCode.startArchitecture', start('architecture')),
    vscode.commands.registerCommand('santriCode.startDesign', start('design')),
    vscode.commands.registerCommand('santriCode.startSdlc', start('sdlc')),
    vscode.window.registerUriHandler({ handleUri: () => focus() }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('santriCode.siteUrl') || e.affectsConfiguration('santriCode.apiBaseUrl')) {
        app.logoResolver = null;
        app.refreshAll();
      }
    }),
    { dispose: () => { app.runAbort?.abort(); app.loginFlow?.close(); } },
  );

  // Background refresh so the status bar shows credits before the panel is opened.
  context.secrets.get(TOKEN_KEY).then((token) => (token ? app.refreshAll() : app.setState({ phase: 'signedOut' })));
  return app;
}

function deactivate() {}

module.exports = { activate, deactivate, documentSegments, SUGGESTED };
