import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { colors } from "../../constants/theme";
import { authServices } from "../../services/authServices";
import {
  validarCurpMatematica,
  validarEmail,
  validarPassword,
  validarTelefono,
} from "../../utilities/validaciones";

const PasswordRequirement = ({ met, label }) => (
  <Text style={[styles.requirement, met && styles.requirementMet]}>
    {met ? "✓" : "✗"} {label}
  </Text>
);

export default function RegisterScreen({ navigation }) {
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [curp, setCurp] = useState("");
  const [telefono, setTelefono] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const emailValido = validarEmail(correo);
  const curpValida = validarCurpMatematica(curp);
  const telValido = validarTelefono(telefono);
  const passwordStatus = validarPassword(password);

  const registroHabilitado =
    Boolean(nombre.trim()) &&
    emailValido &&
    curpValida &&
    telValido &&
    passwordStatus.esValida &&
    !loading;

  const onSubmit = async () => {
    if (!nombre.trim() || !correo.trim() || !curp.trim() || !telefono.trim() || !password.trim()) {
      Alert.alert("Campos requeridos", "Completa tu nombre, correo, CURP, teléfono y contraseña.");
      return;
    }

    if (!emailValido) {
      Alert.alert("Correo inválido", "Por favor, ingresa un correo electrónico válido.");
      return;
    }

    if (!curpValida) {
      Alert.alert("CURP inválida", "Ingresa una CURP oficial de 18 caracteres (4 letras, 6 dígitos de fecha, H/M/X, entidad y homoclave).");
      return;
    }

    if (!telValido) {
      Alert.alert("Teléfono inválido", "Ingresa un número de teléfono válido de 10 dígitos.");
      return;
    }

    if (!passwordStatus.esValida) {
      Alert.alert("Contraseña insegura", "La contraseña no cumple con todos los requisitos de seguridad.");
      return;
    }

    setLoading(true);
    const response = await authServices.register(
      correo.trim().toLowerCase(),
      password,
      nombre.trim(),
      "",
      telefono.trim(),
      curp.trim().toUpperCase()
    );
    setLoading(false);

    if (response.error) {
      Alert.alert("No se pudo registrar", response.error);
      return;
    }

    Alert.alert(
      response.reactivada ? "Cuenta creada desde cero" : "Revisa tu correo",
      response.reactivada
        ? "Tu cuenta ha sido registrada nuevamente desde cero y vinculada a tu CURP. Ya puedes iniciar sesión."
        : "Te enviamos un enlace de verificación. Verifica tu correo e inicia sesión para ver tus reservas.",
      [{ text: "OK", onPress: () => navigation.replace("Login") }]
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Crea tu cuenta</Text>
        <Text style={styles.subtitle}>
          Tu CURP y correo quedarán vinculados para sincronizar también las reservas que hagas en recepción.
        </Text>

        <View style={styles.card}>
          <TextInput
            placeholder="Nombre completo"
            placeholderTextColor={colors.textSecondary}
            value={nombre}
            onChangeText={setNombre}
            style={styles.input}
          />

          <TextInput
            placeholder="Correo electrónico"
            placeholderTextColor={colors.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            value={correo}
            onChangeText={setCorreo}
            style={[styles.input, correo.length > 0 && !emailValido && styles.inputError]}
          />

          <TextInput
            placeholder="CURP (18 caracteres)"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="characters"
            maxLength={18}
            value={curp}
            onChangeText={(txt) => setCurp(txt.toUpperCase().replace(/\s+/g, ""))}
            style={[
              styles.input,
              curp.length > 0 && (curpValida ? styles.inputValid : styles.inputError),
            ]}
          />
          {curp.length > 0 && !curpValida && (
            <Text style={styles.helperError}>
              Formato CURP: 4 letras + 6 dígitos (AAMMDD) + H/M + 2 letras estado + 3 consonantes + 2 caracteres ({curp.length}/18)
            </Text>
          )}

          <TextInput
            placeholder="Teléfono (10 dígitos)"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            maxLength={10}
            value={telefono}
            onChangeText={(txt) => setTelefono(txt.replace(/\D/g, ""))}
            style={[
              styles.input,
              telefono.length > 0 && (telValido ? styles.inputValid : styles.inputError),
            ]}
          />

          <TextInput
            placeholder="Contraseña"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />

          {password.length > 0 && (
            <View style={styles.requirementsContainer}>
              <PasswordRequirement met={passwordStatus.longitud} label="Mínimo 8 caracteres" />
              <PasswordRequirement met={passwordStatus.mayuscula} label="Una mayúscula" />
              <PasswordRequirement met={passwordStatus.minuscula} label="Una minúscula" />
              <PasswordRequirement met={passwordStatus.numero} label="Un número" />
              <PasswordRequirement met={passwordStatus.especial} label="Un caracter especial" />
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, !registroHabilitado && styles.disabledButton]}
            onPress={onSubmit}
            disabled={!registroHabilitado}
          >
            {loading ? (
              <ActivityIndicator color={colors.textLight} />
            ) : (
              <Text style={styles.primaryButtonText}>Crear cuenta</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.secondaryButtonText}>Ya tengo cuenta</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 15,
    padding: 18,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.error,
  },
  inputValid: {
    borderColor: colors.success,
  },
  helperError: {
    fontSize: 11,
    color: colors.error,
    marginTop: -6,
    paddingHorizontal: 4,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 15,
    alignItems: "center",
    marginTop: 4,
  },
  primaryButtonText: {
    color: colors.textLight,
    fontWeight: "800",
    fontSize: 16,
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontWeight: "600",
  },
  disabledButton: {
    backgroundColor: colors.surface,
    opacity: 0.6,
  },
  requirementsContainer: {
    paddingHorizontal: 10,
    paddingBottom: 5,
    gap: 2,
  },
  requirement: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  requirementMet: {
    color: colors.success,
  },
});