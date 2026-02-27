import fs from "node:fs/promises";
import path from "node:path";

const managementUrl = "https://akatsukibotlicense-production.up.railway.app";
const adminToken = "akatsuki_admin_9f3K2pQ1";
const logPath = "../Bot/UPDATE_LOG.md";

async function syncAll() {
    try {
        console.log("🧹 チャンネルを初期化し、全履歴を同期します...");

        // リセットAPIを叩く
        const resetRes = await fetch(`${managementUrl}/api/updates/reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: adminToken })
        });

        if (!resetRes.ok) {
            const err = await resetRes.json().catch(() => ({}));
            console.error(`❌ リセットに失敗しました: ${err.error || resetRes.statusText}`);
            return;
        }
        const resetData = await resetRes.json();
        console.log(`✅ チャンネルの初期化成功: ${resetData.message}`);

        const content = await fs.readFile(logPath, "utf-8");
        // セクションを抽出（--- で区切られた ## v で始まるもの）
        const sections = content.split(/\n---\n/).filter(s => s.trim().startsWith("## v") || s.trim().includes("システムアップデート"));

        // 最新が上なので、最古から順に送る
        const reversedSections = sections.reverse();

        for (const section of reversedSections) {
            const match = section.match(/## (v[\d.〜]+)/);
            if (!match) continue;

            const version = match[1];
            const isFix = section.includes("システム修正");
            const title = isFix
                ? `システム修正のお知らせ（${version}）`
                : `システムアップデートのお知らせ（${version}）`;
            const bodyContent = section.replace(/^## .*?\n/, "").trim();

            console.log(`📡 送信中: ${title}...`);
            const res = await fetch(`${managementUrl}/api/updates/receive`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    version,
                    title,
                    content: bodyContent,
                    color: isFix ? 0xF1C40F : 0x2ECC71,
                    token: adminToken
                })
            });

            if (!res.ok) {
                console.error(`❌ 送信失敗: ${title}`);
            }
            await new Promise(r => setTimeout(r, 1000)); // レートリミット回避
        }
        console.log("🎉 全履歴の同期が完了しました。");
    } catch (e) {
        console.error("🔥 エラー:", e.message);
    }
}

syncAll();
