const { parseExpression } = require('cron-parser');

try {
    console.log('Testing 6-field expression: */30 * * * * *');
    const interval = parseExpression('*/30 * * * * *');
    console.log('Success:', interval.next().toString());
} catch (err) {
    console.log('Error:', err.message);
}

try {
    console.log('Testing 5-field expression: * * * * *');
    const interval = parseExpression('* * * * *');
    console.log('Success:', interval.next().toString());
} catch (err) {
    console.log('Error:', err.message);
}
