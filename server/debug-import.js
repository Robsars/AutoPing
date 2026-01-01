const cronParser = require('cron-parser');
console.log('Type of cronParser:', typeof cronParser);
console.log('Keys:', Object.keys(cronParser));
console.log('Type of parseExpression:', typeof cronParser.parseExpression);

try {
    const interval = cronParser.parseExpression('*/30 * * * * *');
    console.log('Success with cronParser.parseExpression');
} catch (e) {
    console.log('Error with cronParser.parseExpression:', e.message);
}

try {
    const { parseExpression } = require('cron-parser');
    console.log('Type of destructured parseExpression:', typeof parseExpression);
    const interval = parseExpression('*/30 * * * * *');
    console.log('Success with destructured parseExpression');
} catch (e) {
    console.log('Error with destructured parseExpression:', e.message);
}
