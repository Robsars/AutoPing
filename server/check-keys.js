const cronParser = require('cron-parser');
console.log(Object.keys(cronParser));
try {
    console.log('parseExpression type:', typeof cronParser.parseExpression);
} catch (e) {
    console.log('parseExpression error:', e.message);
}
