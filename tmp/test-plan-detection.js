const { detectPlanType } = require('../src/utils/boothParser');
const { PLANS } = require('../src/constants/plans');

const testCases = [
    { input: "AkatsukiBot Pro (月額版)", expected: PLANS.PRO.id },
    { input: "AkatsukiBot Pro (年額版)", expected: PLANS.PRO_YEARLY.id },
    { input: "AkatsukiBot Pro Yearly Subscription", expected: PLANS.PRO_YEARLY.id },
    { input: "AkatsukiBot Pro+ 1ヶ月分", expected: PLANS.PRO_PLUS.id },
    { input: "AkatsukiBot Pro+ 12ヶ月分", expected: PLANS.PRO_PLUS_YEARLY.id },
    { input: "AkatsukiBot Pro+ 年額", expected: PLANS.PRO_PLUS_YEARLY.id },
    { input: "AkatsukiBot Ultimate (永久版)", expected: PLANS.ULTIMATE.id },
    { input: "Trial Pro", expected: PLANS.TRIAL_PRO.id },
    { input: "トライアル Pro+", expected: PLANS.TRIAL_PRO_PLUS.id },
    { input: "Random Item", expected: PLANS.FREE.id },
];

console.log("=== Plan Detection Test ===");
let successCount = 0;

testCases.forEach(({ input, expected }) => {
    const result = detectPlanType(input);
    const success = result === expected;
    console.log(`[${success ? "PASS" : "FAIL"}] Input: "${input}" | Expected: ${expected} | Result: ${result}`);
    if (success) successCount++;
});

console.log(`\nResult: ${successCount}/${testCases.length} tests passed.`);
if (successCount === testCases.length) {
    console.log("All tests passed successfully!");
} else {
    process.exit(1);
}
