// Test simple con el runner nativo de Node (no requiere dependencias extra).
// Ejecutar con: npm test

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-pass';
process.env.PORT = 0; // puerto aleatorio libre, evita choques al testear

const test = require('node:test');
const assert = require('node:assert');
const { capitalizar } = require('../index.js');

test('capitalizar pone la primera letra en mayúscula y el resto en minúscula', () => {
    assert.strictEqual(capitalizar('mendoza'), 'Mendoza');
    assert.strictEqual(capitalizar('MENDOZA'), 'Mendoza');
    assert.strictEqual(capitalizar('cataratas del iguazú'), 'Cataratas del iguazú');
});

test('capitalizar maneja valores vacíos sin romper', () => {
    assert.strictEqual(capitalizar(''), '');
    assert.strictEqual(capitalizar(null), '');
    assert.strictEqual(capitalizar(undefined), '');
});

test('capitalizar limpia espacios en los extremos', () => {
    assert.strictEqual(capitalizar('   bariloche   '), 'Bariloche');
});
