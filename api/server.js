const app = require('./index');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nawa POS API running on port ${PORT}`));
