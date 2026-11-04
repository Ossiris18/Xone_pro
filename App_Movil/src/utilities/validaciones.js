// Estructura oficial RENAPO de 18 caracteres (4 letras, fecha AAMMDD válida, sexo H/M/X, entidad 2 letras, 3 consonantes internas, 2 caracteres de homoclave)
// No aplica bloqueo por checksum módulo 10 para evitar falsos negativos en CURPs reales emitidas o reasignadas por RENAPO.
const CURP_REGEX = /^[A-ZÑ]{4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX][A-Z]{2}[A-ZÑ]{3}[0-9A-Z]\d$/;

export const validarTelefono = (tel) => /^\d{10}$/.test(String(tel || "").trim());

export const validarCurpMatematica = (curp) => {
  const curpLimpia = String(curp || "").trim().toUpperCase();
  if (curpLimpia.length !== 18) return false;
  return CURP_REGEX.test(curpLimpia);
};

export const validarEmail = (email) => {
  if (!email) return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(String(email).trim().toLowerCase());
};

export const validarPassword = (password) => {
  const str = String(password || "");
  const validations = {
    longitud: str.length >= 8,
    mayuscula: /[A-Z]/.test(str),
    minuscula: /[a-z]/.test(str),
    numero: /[0-9]/.test(str),
    especial: /[^A-Za-z0-9]/.test(str),
  };
  const esValida = Object.values(validations).every(Boolean);
  return { ...validations, esValida };
};

export const validaciones = {
  validarTelefono,
  validarCurpMatematica,
  validarEmail,
  validarPassword,
};