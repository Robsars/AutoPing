const cronParser = require('cron-parser');

const expressions = [
    '*/30 * * * * *', // 30 seconds
    '* * * * *',      // 1 minute
    '*/5 * * * *',    // 5 minutes
];

expressions.forEach(expr => {
    try {
        const interval = cronParser.parseExpression(expr);
        console.log(`Expression: "${expr}" -> Next: ${interval.next().toDate()}`);
    } catch (err) {
        console.error(`Expression: "${expr}" -> Error: ${err.message}`);
    }
});
