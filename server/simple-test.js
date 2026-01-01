const cronParser = require('cron-parser');

try {
    const interval = cronParser.parseExpression('*/30 * * * * *');
    console.log('Success:', interval.next().toString());
} catch (err) {
    console.log('Error:', err.message);
}
