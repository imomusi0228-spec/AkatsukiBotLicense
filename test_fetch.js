const managementUrl = "https://akatsukibotlicense-production.up.railway.app";
const adminToken = "akatsuki_admin_9f3K2pQ1";

async function test() {
    console.log("Testing connection...");
    try {
        const res = await fetch(`${managementUrl}/api/version`);
        const data = await res.json();
        console.log("Success:", data);
    } catch (e) {
        console.error("Fail:", e.message);
    }
}
test();
