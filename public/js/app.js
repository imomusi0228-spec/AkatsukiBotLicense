const { createApp, ref, computed, onMounted, reactive, watch } = Vue;

createApp({
    setup() {
        const user = ref(null);
        const isAdminLogged = ref(false);
        const loading = ref(true);
        const activeTab = ref('dashboard');

        // Data
        const stats = ref({
            paid_count: 0,
            total_count: 0,
            active_count: 0,
            expiring_soon_count: 0,
            new_this_month: 0,
            renewed_this_month: 0
        });
        const subscriptions = ref([]);
        const applications = ref([]);
        const subPagination = ref({ total: 0, page: 1, pages: 1, limit: 50 });
        const appPagination = ref({ total: 0, page: 1, pages: 1, limit: 50 });
        const auditLogs = ref([]);
        const logPagination = ref({ total: 0, page: 1, pages: 1, limit: 50 });
        const logFilter = reactive({ search: '', action: '' });
        const blacklist = ref([]);
        const settings = ref({ webhook_url: '' });
        const detailedStats = ref({
            tier_distribution: { paid: {}, trial: {}, overall: {} },
            retention_rate: 0,
            growth_data: [],
            heatmap_data: [],
            top_commands: []
        });
        const selectedSubs = ref([]);
        const roleMappings = ref([]);
        const staffList = ref([]);
        const automationRules = ref([]);
        const apiKeys = ref([]);
        const newRule = reactive({ pattern: '', tier: 'Pro', duration_months: 1, duration_days: null, match_type: 'regex', tier_mode: 'fixed' });
        const newApiKeyName = ref('');

        const isBackingUp = ref(false);
        const systemStatus = ref({
            bot: { status: 'loading...', latency: 0, uptime: 0, guilds: 0, users: 0 },
            system: { load: '0.00', memory: { percent: '0%', used: '0GB', total: '0GB' }, platform: '', release: '', cpuModel: '', cpuCount: 0 },
            timestamp: new Date()
        });

        const userDetail = ref({
            id: '',
            displayName: '',
            avatar: null,
            servers: []
        });

        const importPreview = ref([]);
        const isImporting = ref(false);
        // Filters & Search
        const searchQuery = ref('');
        const filterStatus = ref('all'); // all, active, expired, expiring

        // Modal State
        // ... (remaining modal state) ...

        // Computed
        // We now mostly rely on server-side filtering, but we keep this for reactive UI if needed
        const filteredSubscriptions = computed(() => {
            return subscriptions.value;
        });

        const currentUserRole = computed(() => {
            if (isAdminLogged.value) return 'admin';
            return user.value?.role || 'user';
        });

        // Methods
        const showAlert = (message, type = 'info') => {
            // Simple alert for now, could be replaced with a more sophisticated UI notification
            alert(message);
        };

        const checkAuth = async () => {
            console.log('[CheckAuth] Starting status check...');
            try {
                // Consistency: Use the same options as api(), plus cache-busting
                const res = await fetch('/api/auth/status?t=' + Date.now(), {
                    credentials: 'same-origin'
                });
                const data = await res.json();
                console.log('[CheckAuth] Received status:', data);

                if (data.authenticated) {
                    console.log('[CheckAuth] Logged in as:', data.user.username);
                    user.value = data.user;
                    loadData(true);
                } else if (localStorage.getItem('admin_token')) {
                    console.log('[CheckAuth] Falling back to admin_token');
                    isAdminLogged.value = true;
                    loadData(true);
                } else {
                    console.log('[CheckAuth] User not logged in.');
                    loading.value = false;
                }
            } catch (e) {
                console.error('[CheckAuth] Critical failure:', e);
                loading.value = false;
            }
        };

        const getCookie = (name) => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        };

        const api = async (endpoint, method = 'GET', body = null) => {
            const headers = { 'Content-Type': 'application/json' };
            const token = localStorage.getItem('admin_token');
            if (token) headers['Authorization'] = token;

            // Add CSRF token for state-changing methods
            if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
                const csrfToken = getCookie('csrf_token');
                if (csrfToken) {
                    headers['X-CSRF-Token'] = csrfToken;
                } else {
                    // Fallback: try to fetch it if not in cookie yet
                    try {
                        const csrfRes = await fetch('/api/auth/csrf');
                        const csrfData = await csrfRes.json();
                        if (csrfData.csrfToken) headers['X-CSRF-Token'] = csrfData.csrfToken;
                    } catch (e) {
                        console.warn('CSRF fetch failed:', e);
                    }
                }
            }

            const res = await fetch(`/api${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : null,
                credentials: 'same-origin'
            });
            console.log(`[API Response] ${method} ${endpoint} - Status: ${res.status}`);

            if (res.status === 401 || res.status === 403) {
                console.warn(`[Auth Violation] API returned ${res.status} for ${endpoint}.`);
                if (res.status === 403) {
                    const errorMsg = await res.json().catch(() => ({}));
                    if (errorMsg.error === 'CSRF Token Mismatch') {
                        // Silently retry once after fetching CSRF could be better, but for now just alert
                        alert('セッションの有効期限が切れました。ページを更新してもう一度お試しください。');
                    } else {
                        alert('権限がありません。');
                    }
                }
                // Optional: don't reset session on 403 unless it's a real auth failure
                // user.value = null;
                // isAdminLogged.value = false;
            }
            return res.json();
        };

        const fetchRoleMappings = async () => {
            try {
                const res = await api('/settings/roles');
                roleMappings.value = res;
            } catch (err) {
                console.error('Failed to fetch role mappings:', err);
            }
        };

        const saveRoleMapping = async (mapping) => {
            try {
                await api('/settings/roles', 'POST', mapping);
                showAlert('ロール設定を保存しました。', 'success');
            } catch (err) {
                showAlert('保存に失敗しました: ' + err.message, 'danger');
            }
        };

        const addRoleMapping = () => {
            const tier = prompt('ティア名を入力してください (例: Pro, Pro+)');
            if (tier) {
                roleMappings.value.push({ tier, role_id: '' });
            }
        };

        const rejectApplication = async (id) => {
            if (!confirm('この申請を却下しますか？')) return;
            try {
                await api(`/applications/${id}/reject`, 'POST');
                loadData();
                showAlert('申請を却下しました。', 'info');
            } catch (err) {
                showAlert('却下失敗: ' + err.message, 'danger');
            }
        };

        const holdApplication = async (id) => {
            if (!confirm('この申請を保留にしますか？')) return;
            try {
                await api(`/applications/${id}/hold`, 'POST');
                loadData();
                showAlert('申請を保留にしました。', 'warning');
            } catch (err) {
                showAlert('保留失敗: ' + err.message, 'danger');
            }
        };

        const deleteRoleMapping = async (tier) => {
            if (!confirm(`ティア「${tier}」の設定を削除しますか？`)) return;
            try {
                await api(`/settings/roles/${tier}`, 'DELETE');
                roleMappings.value = roleMappings.value.filter(m => m.tier !== tier);
                showAlert('設定を削除しました。', 'info');
            } catch (err) {
                showAlert('削除に失敗しました: ' + err.message, 'danger');
            }
        };

        const fetchStaff = async () => {
            try {
                const res = await api('/settings/staff');
                staffList.value = res;
            } catch (err) {
                console.error('Failed to fetch staff:', err);
            }
        };

        const updateStaffRole = async (member) => {
            try {
                await api('/settings/staff', 'POST', member);
                showAlert('スタッフ権限を更新しました。', 'success');
            } catch (err) {
                showAlert('更新に失敗しました: ' + err.message, 'danger');
            }
        };

        const addStaff = async () => {
            const userId = prompt('追加するユーザーのDiscord IDを入力してください');
            if (!userId) return;
            const username = prompt('ユーザー名を入力してください (任意)', 'New Staff');
            const role = confirm('管理者に設定しますか？ (キャンセルでモデレーター)') ? 'admin' : 'moderator';

            try {
                await api('/settings/staff', 'POST', { user_id: userId, username, role });
                fetchStaff();
                showAlert('スタッフを追加しました。', 'success');
            } catch (err) {
                showAlert('追加に失敗しました: ' + err.message, 'danger');
            }
        };

        const removeStaff = async (userId) => {
            if (!confirm(`スタッフ (ID: ${userId}) を削除しますか？`)) return;
            try {
                await api(`/settings/staff/${userId}`, 'DELETE');
                staffList.value = staffList.value.filter(s => s.user_id !== userId);
                showAlert('スタッフを削除しました。', 'info');
            } catch (err) {
                showAlert('削除に失敗しました: ' + err.message, 'danger');
            }
        };

        const loadData = async (isInitial = false) => {
            if (isInitial) loading.value = true;

            // Build query params for subscriptions
            let subQuery = `?page=${subPagination.value.page}&limit=${subPagination.value.limit}`;
            if (searchQuery.value) subQuery += `&search=${encodeURIComponent(searchQuery.value)}`;
            // Filter mapping: active, expired -> we actually handle it via search in SQL ILIKE for now,
            // but for full scalability, we'd add &status= filter to API.
            // For now, let's just use the search param.

            const [sRes, aRes, stData, setsRes, dsData, blRes, rmRes, staffRes, rulesRes, keysRes] = await Promise.all([
                api(`/subscriptions${subQuery}`),
                api(`/applications?page=${appPagination.value.page}&limit=${appPagination.value.limit}`),
                api('/subscriptions/stats'),
                api('/settings'),
                api('/subscriptions/stats/detailed'),
                api('/blacklist'),
                api('/settings/roles'), // Fetch role mappings
                api('/settings/staff'), // Fetch staff
                api('/automations/rules'),
                api('/automations/keys')
            ]);

            subscriptions.value = sRes.data || [];
            subPagination.value = sRes.pagination || subPagination.value;

            applications.value = aRes.data || [];
            blacklist.value = blRes || [];
            appPagination.value = aRes.pagination || appPagination.value;

            if (stData) stats.value = stData;
            // Merge properties to avoid losing webhook_url if it's missing from API
            if (setsRes) {
                Object.assign(settings.value, setsRes);
            }
            detailedStats.value = dsData || { tier_distribution: { paid: {}, trial: {}, overall: {} }, retention_rate: 0, growth_data: [] };
            roleMappings.value = rmRes || []; // Assign role mappings
            staffList.value = staffRes || []; // Assign staff list
            automationRules.value = rulesRes || [];
            apiKeys.value = keysRes || [];

            if (isInitial) loading.value = false;
            loadAnnouncements(); // Fetch announcements too
        };

        const loadLogs = async (page = 1) => {
            logPagination.value.page = page;
            let query = `?page=${page}&limit=${logPagination.value.limit}`;
            if (logFilter.search) query += `&search=${encodeURIComponent(logFilter.search)}`;
            if (logFilter.action) query += `&action_type=${logFilter.action}`;

            const res = await api(`/logs${query}`);
            auditLogs.value = res.logs || [];
            logPagination.value = res.pagination || logPagination.value;
        };

        const updateSetting = async (key, value) => {
            await api('/settings', 'POST', { key, value });
            alert('設定を保存しました');
        };

        const testWebhook = async () => {
            try {
                const res = await api('/settings/test-webhook', 'POST');
                if (res.success) {
                    alert('テスト送信をリクエストしました。Discordを確認してみてください。');
                } else if (res.error) {
                    alert('送信失敗: ' + res.error);
                } else {
                    alert('送信に失敗した可能性があります。WebhookURLが正しいか確認してください。');
                }
            } catch (e) {
                alert('エラーが発生しました: ' + e.message);
            }
        };

        const loadSystemStatus = async () => {
            try {
                const data = await api('/system/status');
                if (data) systemStatus.value = data;
            } catch (err) {
                console.error('Failed to load system status:', err);
            }
        };

        const triggerBackup = async () => {
            if (!confirm('データベースのフルバックアップを実行しますか？')) return;
            isBackingUp.value = true;
            try {
                const res = await api('/system/backup', 'POST');
                if (res.success) {
                    alert(`バックアップが完了しましたわ！\nファイル名: ${res.fileName}\n形式: ${res.type.toUpperCase()}`);
                } else {
                    alert('バックアップに失敗しました: ' + (res.error || '不明なエラー'));
                }
            } catch (err) {
                alert('エラーが発生しました: ' + err.message);
            } finally {
                isBackingUp.value = false;
            }
        };

        const showUserDetails = async (sub) => {
            userDetail.value.id = sub.user_id;
            userDetail.value.displayName = sub.user_display_name;
            userDetail.value.avatar = sub.user_avatar ? `https://cdn.discordapp.com/avatars/${sub.user_id}/${sub.user_avatar}.png?size=128` : null;
            userDetail.value.servers = [];

            const modal = new bootstrap.Modal(document.getElementById('userDetailModal'));
            modal.show();

            try {
                const servers = await api(`/subscriptions/user/${sub.user_id}/servers`);
                userDetail.value.servers = servers || [];
            } catch (err) {
                console.error('Failed to fetch user servers:', err);
            }
        };

        const formatDuration = (seconds) => {
            const d = Math.floor(seconds / (3600 * 24));
            const h = Math.floor(seconds % (3600 * 24) / 3600);
            const m = Math.floor(seconds % 3600 / 60);
            const s = Math.floor(seconds % 60);
            return `${d}d ${h}h ${m}m ${s}s`;
        };

        const toggleSelectAll = (e) => {
            if (e.target.checked) {
                selectedSubs.value = subscriptions.value.map(s => s.guild_id);
            } else {
                selectedSubs.value = [];
            }
        };

        const bulkDeactivate = async () => {
            if (!confirm(`${selectedSubs.value.length}件のライセンスを一括停止しますか？`)) return;
            loading.value = true;
            try {
                // For simplicity, we process them one by one or in a loop
                // In a production app, we'd have a specific /bulk endpoint
                for (const gId of selectedSubs.value) {
                    await api(`/subscriptions/${gId}`, 'DELETE');
                }
                alert('一括停止が完了しました');
                selectedSubs.value = [];
                loadData();
            } catch (e) {
                alert('一括処理中にエラーが発生しました');
            } finally {
                loading.value = false;
            }
        };

        const changePage = (type, page) => {
            if (type === 'sub') {
                subPagination.value.page = page;
            } else {
                appPagination.value.page = page;
            }
            loadData();
        };

        const search = () => {
            subPagination.value.page = 1;
            loadData();
        };

        const formatDate = (dateStr) => {
            if (!dateStr) return '無期限';
            return new Date(dateStr).toLocaleDateString('ja-JP');
        };

        // Actions

        const toggleAutoRenew = async (sub) => {
            const newState = !sub.auto_renew;
            const gId = sub.guild_id;
            await api(`/subscriptions/${gId}/auto-renew`, 'PATCH', { enabled: newState });
            sub.auto_renew = newState;
        };

        const copyText = (text) => {
            navigator.clipboard.writeText(text);
        };

        const openEditModal = (sub) => {
            editModal.data = { ...sub };
            editModal.extendDuration = 1;
            const modal = new bootstrap.Modal(document.getElementById('editModal'));
            modal.show();
        };

        const saveEdit = async () => {
            const gId = editModal.data.guild_id;
            await api(`/subscriptions/${gId}`, 'PUT', {
                action: 'extend',
                duration: editModal.extendDuration + editModal.extendUnit
            });
            bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
            loadData();
        };

        const updateTier = async () => {
            const gId = editModal.data.guild_id;
            await api(`/subscriptions/${gId}`, 'PUT', {
                action: 'update_tier',
                tier: editModal.data.tier
            });
            alert('プランを更新しました');
            loadData();
        }

        const createSub = async () => {
            if (!addModal.data.guild_id || !addModal.data.user_id) {
                alert('サーバーIDとユーザーIDは必須やな');
                return;
            }
            await api('/subscriptions', 'POST', addModal.data);
            bootstrap.Modal.getInstance(document.getElementById('addModal')).hide();
            loadData();
        };

        const approveApp = async (app) => {
            if (!confirm('承認してキーを発行しますか？')) return;
            const res = await api(`/applications/${app.id}/approve`, 'POST');
            if (res.success) {
                keyModal.key = res.key;
                keyModal.tier = res.tier;
                new bootstrap.Modal(document.getElementById('keyModal')).show();
                loadData();
            }
        };

        const reissueKey = async (app) => {
            if (!confirm('キーを再発行しますか？現在のキーは無効化され、新しいキーがユーザーにDM送信されます。')) return;
            try {
                const res = await api(`/applications/${app.id}/reissue`, 'POST');
                if (res.success) {
                    alert('新しいキーを発行し、ユーザーに通知しました。');
                    loadData();
                } else {
                    alert('再発行失敗: ' + (res.error || '不明なエラー'));
                }
            } catch (err) {
                alert('エラーが発生しました: ' + err.message);
            }
        };

        const deleteApp = async (id) => {
            if (!confirm('削除しますか？')) return;
            await api(`/applications/${id}`, 'DELETE');
            loadData();
        };

        const deactivateSub = async (sub) => {
            if (!confirm('ライセンスを無効化（停止）しますか？')) return;
            const gId = sub.guild_id;
            await api(`/subscriptions/${gId}`, 'DELETE');
            loadData();
        };

        const resumeSub = async (sub) => {
            if (!confirm('ライセンスを再開しますか？')) return;
            const gId = sub.guild_id;
            await api(`/subscriptions/${gId}`, 'PUT', {
                action: 'toggle_active',
                is_active: true
            });
            loadData();
        };

        const hardDeleteSub = async (sub) => {
            if (!confirm('ライセンス情報を「完全に削除」しますか？\nこの操作は取り消せません。')) return;
            const gId = sub.guild_id;
            await api(`/subscriptions/${gId}/delete`, 'DELETE');
            loadData();
        };

        const addAutomationRule = async () => {
            if (newRule.match_type !== 'name_match' && !newRule.pattern) {
                return alert('パターンを入力してな');
            }
            await api('/automations/rules', 'POST', newRule);
            // Reset to defaults
            newRule.pattern = '';
            newRule.match_type = 'regex';
            newRule.tier_mode = 'fixed';
            loadData();
        };

        const deleteAutomationRule = async (id) => {
            if (!confirm('ルールを削除しますか？')) return;
            await api(`/automations/rules/${id}`, 'DELETE');
            loadData();
        };

        const createApiKey = async () => {
            const res = await api('/automations/keys', 'POST', { name: newApiKeyName.value });
            if (res.key) {
                alert('APIキーを発行しました。一度しか表示されないのでメモしておいてな：\n' + res.key);
                newApiKeyName.value = '';
                loadData();
            }
        };

        const deleteApiKey = async (keyId) => {
            if (!confirm('APIキーを削除しますか？')) return;
            await api(`/automations/keys/${keyId}`, 'DELETE');
            loadData();
        };

        const openAppDetails = (app) => {
            appDetailsModal.data = app;
            new bootstrap.Modal(document.getElementById('appDetailsModal')).show();
        };

        const applyTemplate = (type) => {
            const version = stats.value.botVersion || 'v1.X.X';
            const templates = {
                update: {
                    title: `【アップデート】AkatsukiBot ${version} 公開のお知らせ`,
                    content: `## 🚀 アップデート情報 (${version})\n\nAkatsukiBotの最新バージョンを公開しました。今回の主な変更点は以下の通りです。\n\n### ✨ 新機能\n- \n- \n\n### 🔧 改善・修正\n- \n- \n\n今後もより使いやすくなるよう改善を続けてまいります。ぜひご活用ください。`,
                    type: 'normal'
                },
                maintenance: {
                    title: `【メンテナンス】定期メンテナンス実施のお知らせ`,
                    content: `## 🔧 メンテナンスのお知らせ\n\n以下の日程で定期メンテナンスを実施します。メンテナンス中はボットの一部機能が利用できなくなるため、ご注意ください。\n\n**📅 日時**\n202X年XX月XX日 XX:00 〜 XX:00\n\n**📝 内容**\n- サーバーの最適化\n- データベースのバックアップ\n\nご不便をおかけしますが、ご理解とご協力をお願いします。`,
                    type: 'important'
                },
                fix: {
                    title: `【不具合修正】特定環境での動作不良に関する修正`,
                    content: `## 🐞 不具合修正のお知らせ\n\n報告されていた以下の不具合を修正しました。ご不便をおかけし、申し訳ございませんでした。\n\n**✅ 修正内容**\n- \n- \n\n他にも不備や不具合が見つかった場合は、サポートまでご連絡ください。`,
                    type: 'normal'
                }
            };

            const template = templates[type];
            if (template) {
                announceModal.title = template.title;
                announceModal.content = template.content;
                announceModal.type = template.type;
            }
        };

        const fetchBotVersion = async () => {
            try {
                const res = await api('/version');
                if (res.version) {
                    stats.value.botVersion = res.version;
                    // If title is currently a template or empty, update it
                    if (!announceModal.title || announceModal.title.includes('v1.X.X')) {
                        announceModal.title = announceModal.title.replace('v1.X.X', res.version);
                    }
                    if (announceModal.content.includes('v1.X.X')) {
                        announceModal.content = announceModal.content.replace('v1.X.X', res.version);
                    }
                }
            } catch (e) {
                console.error('Failed to fetch version:', e);
            }
        };

        const insertText = (before, after = '') => {
            const textarea = document.querySelector('textarea[v-model="announceModal.content"]');
            if (!textarea) return;

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = announceModal.content;
            const selection = text.substring(start, end);

            const replacement = before + selection + after;
            announceModal.content = text.substring(0, start) + replacement + text.substring(end);

            // Re-focus and set cursor inside if wrapping
            setTimeout(() => {
                textarea.focus();
                if (after) {
                    textarea.setSelectionRange(start + before.length, end + before.length);
                } else {
                    textarea.setSelectionRange(start + replacement.length, start + replacement.length);
                }
            }, 0);
        };

        const sendAnnouncement = async () => {
            if (!announceModal.title || !announceModal.content) {
                alert('タイトルと内容は必須やな');
                return;
            }
            announceModal.sending = true;
            try {
                const res = await api('/announce', 'POST', {
                    title: announceModal.title,
                    content: announceModal.content,
                    type: announceModal.type,
                    scheduled_at: announceModal.scheduled_at || null,
                    associated_tasks: announceModal.associated_tasks,
                    target_tiers: announceModal.target_tiers
                });
                if (res.success) {
                    alert('告知を送信/予約したで！');
                    announceModal.title = '';
                    announceModal.content = '';
                    announceModal.type = 'normal';
                    announceModal.scheduled_at = '';
                    announceModal.associated_tasks = [];
                    loadAnnouncements();
                } else {
                    alert('エラー: ' + (res.error || '不明なエラー'));
                }
            } finally {
                announceModal.sending = false;
            }
        };

        const postNow = async (ann) => {
            if (!confirm('この告知を今すぐ送信する？')) return;
            const res = await api(`/announce/${ann.id}`, 'PUT', {
                ...ann,
                scheduled_at: null // Set to null effectively sends it now in logic or we can just send it now
            });
            if (res.success) {
                // Actually, let's just use the existing POST logic but for this ID
                // For now, let's trigger it by updating scheduled_at to past
                const postRes = await api(`/announce/${ann.id}`, 'PUT', {
                    title: ann.title,
                    content: ann.content,
                    type: ann.type,
                    scheduled_at: new Date().toISOString(),
                    associated_tasks: ann.associated_tasks
                });

                if (postRes.success) {
                    alert('送信したで！');
                    loadAnnouncements();
                }
            }
        };


        // Shortcuts
        const handleKeydown = (e) => {
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                document.getElementById('searchInput').focus();
            }
            if (e.key === 'Escape') {
                searchQuery.value = '';
            }
        };

        watch(activeTab, (newTab) => {
            if (newTab === 'stats') {
                setTimeout(() => {
                    initGrowthChart();
                    generateHeatmap();
                }, 300);
            }
        });

        const generateHeatmap = () => {
            const container = document.getElementById('vcHeatmap');
            if (!container) return;
            // The HTML already uses v-for with detailedStats.heatmap_data, 
            // but we can add extra polish here if needed, or simply ensure the 
            // data is correctly formatted. The Current HTML logic is:
            // v-for="day in detailedStats.heatmap_data"
            // So we don't strictly need a JS function to render it unless we want 
            // a specialized library. We'll stick to the Vue-driven DOM for simplicity 
            // and maybe add a simple animation.
            container.classList.add('fade-in');
        };

        const removeFromBlacklist = async (id) => {
            if (!confirm(`ターゲット ${id} をブラックリストから解除しますか？`)) return;
            const res = await api(`/blacklist/${id}`, 'DELETE');
            if (res) {
                blacklist.value = blacklist.value.filter(b => b.target_id !== id);
                alert('解除しました');
            }
        };

        const openBlacklistModal = () => {
            const id = prompt('ブラックリストに追加するターゲットID (User ID or Guild ID) を入力してください:');
            if (!id) return;
            const type = prompt('タイプを入力してください (user/guild):', 'user');
            if (!type) return;
            const reason = prompt('理由を入力してください (オプション):');

            api('/blacklist', 'POST', { target_id: id, type, reason }).then(res => {
                if (res) {
                    alert('追加しました');
                    loadData();
                }
            });
        };

        const handleCsvDrop = (e) => {
            const file = e.dataTransfer.files[0];
            if (file) processCsv(file);
        };

        const handleCsvSelect = (e) => {
            const file = e.target.files[0];
            if (file) processCsv(file);
        };

        const processCsv = (file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                const rows = text.split('\n');
                const header = rows[0].split(',');
                const orderIdx = header.findIndex(h => h.includes('注文番号') || h.includes('Order ID'));
                const prodIdx = header.findIndex(h => h.includes('商品名') || h.includes('Product'));

                const results = [];
                for (let i = 1; i < rows.length; i++) {
                    const cols = rows[i].split(',');
                    if (cols.length < 2) continue;

                    const orderId = cols[orderIdx]?.replace(/"/g, '').trim();
                    const prodName = cols[prodIdx]?.replace(/"/g, '').trim() || '';

                    if (orderId) {
                        results.push({
                            order_id: orderId,
                            tier: prodName.includes('Pro+') ? 'Pro+' : 'Pro',
                            duration: prodName.includes('年') || prodName.includes('Year') ? 12 : 1
                        });
                    }
                }
                importPreview.value = results;
            };
            reader.readAsText(file);
        };

        const executeImport = async () => {
            isImporting.value = true;
            try {
                const res = await api('/import/booth', 'POST', { data: importPreview.value });
                if (res) {
                    alert(`インポート完了！\n成功: ${res.imported}件\nスキップ: ${res.skipped}件`);
                    importPreview.value = [];
                    loadData();
                }
            } finally {
                isImporting.value = false;
            }
        };

        const initGrowthChart = () => {
            const canvas = document.getElementById('growthChart');
            const ctx = canvas?.getContext('2d');
            if (!ctx) return;
            if (window.myGrowthChart) window.myGrowthChart.destroy();

            const data = detailedStats.value.growth_data;
            if (!data || data.length === 0) return;

            // Gradient for the line
            const gradient = ctx.createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, 'rgba(122, 162, 247, 0.4)');
            gradient.addColorStop(1, 'rgba(122, 162, 247, 0)');

            window.myGrowthChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.map(i => i.month),
                    datasets: [{
                        label: '新規契約数',
                        data: data.map(i => i.count),
                        borderColor: '#7aa2f7',
                        borderWidth: 3,
                        pointBackgroundColor: '#7aa2f7',
                        pointBorderColor: '#fff',
                        pointHoverRadius: 6,
                        pointRadius: 4,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index',
                    },
                    scales: {
                        y: { 
                            beginAtZero: true, 
                            grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                            ticks: { color: '#565f89', font: { family: 'JetBrains Mono, monospace' } }
                        },
                        x: { 
                            grid: { display: false },
                            ticks: { color: '#565f89', font: { family: 'JetBrains Mono, monospace' } }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(26, 27, 38, 0.9)',
                            titleColor: '#bb9af7',
                            bodyColor: '#c0caf5',
                            borderColor: '#414868',
                            borderWidth: 1,
                            padding: 10,
                            displayColors: false,
                            cornerRadius: 8,
                            titleFont: { size: 14, weight: 'bold' }
                        }
                    }
                }
            });
        };

        onMounted(() => {
            // Check for tab in hash (e.g., #apps)
            const hash = window.location.hash.replace('#', '');
            const validTabs = ['dashboard', 'apps', 'stats', 'logs', 'settings', 'announce', 'blacklist', 'import'];
            if (hash && validTabs.includes(hash)) {
                activeTab.value = hash;
            }

            checkAuth();
            
            // Periodically update system status
            setInterval(() => {
                if (isAdminLogged.value || user.value) {
                    loadSystemStatus();
                }
            }, 30000);

            window.addEventListener('keydown', handleKeydown);
        });

        // Login Logic
        const loginWithToken = () => {
            const t = document.getElementById('tokenInput').value;
            localStorage.setItem('admin_token', t);
            checkAuth();
        };

        const logout = async () => {
            await api('/auth/logout', 'POST');
            user.value = null;
            localStorage.removeItem('admin_token');
            isAdminLogged.value = false;
        };

        const showOverallPie = () => {
            const modal = new bootstrap.Modal(document.getElementById('pieModal'));
            modal.show();

            // Wait for modal to be visible
            setTimeout(() => {
                const ctx = document.getElementById('overallPieChart').getContext('2d');
                if (window.myPieChart) window.myPieChart.destroy();

                const data = detailedStats.value.tier_distribution.overall;
                const labels = Object.keys(data);

                // Color mapping to match Tier distribution bars
                const colors = labels.map(tier => {
                    if (tier.includes('Trial Pro+')) return 'rgba(224, 175, 104, 0.6)';
                    if (tier.includes('Trial Pro')) return 'rgba(122, 162, 247, 0.6)';
                    if (tier.includes('Pro+')) return '#e0af68';
                    if (tier.includes('Pro')) return '#7aa2f7';
                    if (tier === 'Free') return '#565f89';
                    return '#414868'; // Default border color
                });

                window.myPieChart = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: Object.values(data),
                            backgroundColor: colors,
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: { color: '#c0caf5', padding: 20 }
                            }
                        }
                    }
                });
            }, 300);
        };

        // Modal States (Restored)
        const editModal = reactive({
            show: false,
            data: { guild_id: '', tier: 'Pro', expiry_date: null, auto_renew: false },
            extendDuration: 1,
            extendUnit: 'm'
        });
        const addModal = reactive({
            show: false,
            data: { guild_id: '', user_id: '', tier: 'Pro', duration: '1m' }
        });
        const keyModal = reactive({
            show: false,
            key: '',
            tier: ''
        });
        const appDetailsModal = reactive({
            data: {}
        });
        const announceModal = reactive({
            title: '',
            content: '',
            type: 'normal',
            scheduled_at: '',
            associated_tasks: [],
            target_tiers: [],
            sending: false
        });
        const announcements = ref([]);
        const editAnnounceModal = reactive({
            data: { id: null, title: '', content: '', type: 'normal', scheduled_at: '', associated_tasks: [], target_tiers: [] }
        });

        const loadAnnouncements = async () => {
            const res = await api('/announce', 'GET');
            if (res) announcements.value = res;
        };

        const deleteAnnouncement = async (id) => {
            if (!confirm('この告知を削除（キャンセル）しますか？')) return;
            const res = await api(`/announce/${id}`, 'DELETE');
            if (res.success) {
                alert('削除しました');
                loadAnnouncements();
            }
        };

        const openEditAnnounceModal = (ann) => {
            editAnnounceModal.data = { ...ann, associated_tasks: ann.associated_tasks || [], target_tiers: ann.target_tiers || [] };
            if (ann.scheduled_at) {
                const d = new Date(ann.scheduled_at);
                const offset = d.getTimezoneOffset() * 60000;
                const localISOTime = (new Date(d - offset)).toISOString().slice(0, 16);
                editAnnounceModal.data.scheduled_at = localISOTime;
            }
            if (!editAnnounceModal.instance) {
                editAnnounceModal.instance = new bootstrap.Modal(document.getElementById('editAnnounceModal'));
            }
            editAnnounceModal.instance.show();
        };

        const saveAnnounceEdit = async () => {
            const res = await api(`/announce/${editAnnounceModal.data.id}`, 'PUT', editAnnounceModal.data);
            if (res.success) {
                alert('更新しました');
                editAnnounceModal.instance.hide();
                loadAnnouncements();
            } else {
                alert('エラー: ' + res.error);
            }
        };

        // ... methods (formatDate, toggleAutoRenew, etc.) ...

        return {
            user, isAdminLogged, loading, activeTab,
            stats, detailedStats, filteredSubscriptions, subscriptions, applications, auditLogs,
            subPagination, appPagination, logPagination, logFilter,
            searchQuery, filterStatus, settings, selectedSubs,
            editModal, addModal, keyModal, appDetailsModal,
            formatDate, deactivateSub, resumeSub, hardDeleteSub, toggleAutoRenew, copyText,
            openEditModal, saveEdit, updateTier, createSub,
            approveApp, reissueKey, deleteApp, openAppDetails, loginWithToken, logout,
            loadData, changePage, search, showOverallPie,
            announceModal, sendAnnouncement, loadLogs, updateSetting, testWebhook,
            toggleSelectAll, bulkDeactivate,
            announcements, deleteAnnouncement, openEditAnnounceModal, editAnnounceModal, saveAnnounceEdit, postNow,
            applyTemplate, fetchBotVersion, insertText,
            systemStatus, isBackingUp, formatDuration, triggerBackup,
            blacklist, removeFromBlacklist, openBlacklistModal, handleCsvDrop, handleCsvSelect, executeImport, importPreview, isImporting,
            roleMappings, fetchRoleMappings, saveRoleMapping, addRoleMapping, deleteRoleMapping,
            staffList, fetchStaff, updateStaffRole, addStaff, removeStaff,
            currentUserRole,
            automationRules, addAutomationRule, deleteAutomationRule,
            apiKeys, newApiKeyName, createApiKey, deleteApiKey,
            newRule, rejectApplication, holdApplication,
            translateAction: (action) => {
                const map = {
                    'CREATE': '新規作成',
                    'EXTEND': '期限延長',
                    'UPDATE_TIER': 'Tier変更',
                    'TOGGLE_ACTIVE': '有効/停止',
                    'TOGGLE_AUTO_RENEW': '自動更新切替',
                    'DEACTIVATE': '停止',
                    'DELETE': '削除',
                    'APPROVE_APP': '申請承認',
                    'REJECT_APP': '申請却下',
                    'CANCEL_APP': '申請キャンセル',
                    'HOLD_APP': '申請保留'
                };
                return map[action] || action;
            },
            translateDetails: (details) => {
                if (!details) return '';
                if (details === 'Set auto_renew to true') return '自動更新をオンにしました';
                if (details === 'Set auto_renew to false') return '自動更新をオフにしました';
                if (details.startsWith('Changed to ')) return details.replace('Changed to', 'Tierを') + ' に変更しました';
                if (details.startsWith('Duration extended by ')) return details.replace('Duration extended by', '期間を') + ' 延長しました';
                if (details === 'Created via Discord Slash Command') return 'Discordコマンドから作成';
                if (details === 'Deactivated via Admin Portal') return '管理画面から停止';
                if (details === 'Deactivated via Discord System') return 'Discordシステムによって停止';
                if (details === 'License Activated') return 'ライセンス有効化';
                if (details === 'User Activated locally via panel') return 'パネルから有効化';
                return details;
            },
            exportData: (format) => {
                const tabToType = { dashboard: 'subscriptions', apps: 'applications', logs: 'logs' };
                const type = tabToType[activeTab.value] || 'subscriptions';
                const token = localStorage.getItem('token');
                const url = `/api/export/${type}?format=${format}&token=${token}`;
                window.open(url, '_blank');
            }
        };
    }
}).mount('#app');
