import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth';
import { collection, query, where, getDocs, doc, updateDoc, addDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Lock, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';

const SUPER_ADMIN_EMAIL = 'ossither1830@gmail.com';

function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [mensajeExito, setMensajeExito] = useState('');
  const [cargando, setCargando] = useState(false);

  const regexCorreo = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  const asegurarRegistroSuperAdmin = async (userEmail) => {
    try {
      const q = query(collection(db, "Personal"), where("correo", "==", userEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return { id: snap.docs[0].id, ...snap.docs[0].data() };
      }

      const nuevoAdmin = {
        nombre: 'Administrador General Xone',
        correo: userEmail,
        rol: 'Admin VIP',
        idSucursal: 'TODAS',
        idFranquicia: 'TODAS',
        verificado: true
      };
      const docRef = await addDoc(collection(db, "Personal"), nuevoAdmin);
      return { id: docRef.id, ...nuevoAdmin };
    } catch (firestoreErr) {
      console.warn("Aviso al sincronizar Personal en Firestore:", firestoreErr);
      return {
        id: 'superadmin',
        nombre: 'Administrador General Xone',
        correo: userEmail,
        rol: 'Admin VIP',
        idSucursal: 'TODAS',
        idFranquicia: 'TODAS',
        verificado: true
      };
    }
  };

  const manejarLogin = async (e) => {
    e.preventDefault();
    setCargando(true);
    setError('');
    setMensajeExito('');

    const correoLimpio = email.trim().toLowerCase();

    if (!regexCorreo.test(correoLimpio)) {
      setError('Formato de correo inválido (Ejemplo: usuario@empresa.com)');
      setCargando(false);
      return;
    }

    try {
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, correoLimpio, password);
      } catch (signInErr) {
        if (
          correoLimpio === SUPER_ADMIN_EMAIL &&
          (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/invalid-login-credentials')
        ) {
          userCredential = await createUserWithEmailAndPassword(auth, correoLimpio, password);
          try {
            await sendEmailVerification(userCredential.user);
          } catch (_) {}
        } else {
          throw signInErr;
        }
      }

      const esSuperAdmin = correoLimpio === SUPER_ADMIN_EMAIL;

      if (!userCredential.user.emailVerified && !esSuperAdmin) {
        await auth.signOut();
        setError('Debes verificar tu correo dando clic en el enlace que te enviamos (revisa SPAM).');
        setCargando(false);
        return;
      }

      let datosEmpleado;
      let docId;

      if (esSuperAdmin) {
        const adminDoc = await asegurarRegistroSuperAdmin(correoLimpio);
        docId = adminDoc.id;
        datosEmpleado = adminDoc;
      } else {
        const q = query(collection(db, "Personal"), where("correo", "==", userCredential.user.email));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          setError('No tienes permisos de Staff para entrar a este panel.');
          await auth.signOut();
          setCargando(false);
          return;
        }

        docId = querySnapshot.docs[0].id;
        datosEmpleado = querySnapshot.docs[0].data();
      }

      if (!datosEmpleado.verificado && docId !== 'superadmin') {
        try {
          await updateDoc(doc(db, "Personal", docId), { verificado: true });
        } catch (_) {}
      }

      const sesionData = {
        nombre: datosEmpleado.nombre,
        correo: correoLimpio,
        rol: datosEmpleado.rol,
        idSucursal: datosEmpleado.idSucursal || 'TODAS',
        idFranquicia: datosEmpleado.idFranquicia || 'TODAS'
      };

      localStorage.setItem('sesionSkyStay', JSON.stringify(sesionData));
      onLoginSuccess(sesionData);
    } catch (err) {
      console.error("Detalle del error de Login:", err);
      if (err.code === 'auth/too-many-requests') {
        setError('Acceso bloqueado por múltiples intentos fallidos (Protección Fuerza Bruta).');
      } else if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/configuration-not-found') {
        setError('Falta activar "Correo electrónico/contraseña" en Firebase Console -> Authentication -> Sign-in method.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('El correo ya existe en Firebase Auth con otra contraseña. Haz clic abajo en "¿Contraseña olvidada?" para restablecerla.');
      } else if (err.code === 'permission-denied') {
        setError('Permiso denegado en Firestore Database. En Firebase Console -> Firestore -> Reglas, cambia a "allow read, write: if true;".');
      } else {
        setError(`Error de Firebase (${err.code || 'desconocido'}): ${err.message}`);
      }
    } finally {
      setCargando(false);
    }
  };

  const manejarRecuperacion = async () => {
    setError('');
    setMensajeExito('');

    if (!regexCorreo.test(email.trim())) {
      setError('Para restablecer tu contraseña, primero escribe tu correo arriba y luego presiona este botón.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMensajeExito('Se ha enviado un correo de recuperación. Al cambiar tu contraseña, todas tus sesiones previas se cerrarán automáticamente por seguridad.');
    } catch (err) {
      console.error("DETALLE EXACTO DEL ERROR:", err);
      if (err.code === 'auth/user-not-found') {
        setError('Este correo no está registrado en el sistema.');
      } else if (err.code === 'auth/invalid-email') {
        setError('El correo tiene un formato inválido.');
      } else {
        setError(`Error de Firebase: ${err.message}`);
      }
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}>
      <div style={{ background: 'white', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)', width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{ color: '#0284c7', margin: 0, fontSize: '34px', fontWeight: '900', letterSpacing: '-1px' }}>Xone</h1>
          <p style={{ color: '#64748b', marginTop: '5px', fontSize: '14px' }}>Panel de Administración Cloud</p>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#ef4444', padding: '12px', borderRadius: '8px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', lineHeight: '1.4' }}>
            <AlertCircle size={20} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}

        {mensajeExito && (
          <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '12px', borderRadius: '8px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', lineHeight: '1.4' }}>
            <CheckCircle2 size={20} style={{ flexShrink: 0 }} /> {mensajeExito}
          </div>
        )}

        <form onSubmit={manejarLogin} style={{ display: 'grid', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#334155', fontSize: '13px' }}>Correo Oficial</label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: '#94a3b8' }} />
              <input
                type="email"
                required
                placeholder="ossither1830@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', padding: '11px 12px 11px 38px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outlineColor: '#0284c7' }}
              />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: '#334155', fontSize: '13px' }}>Contraseña</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: '#94a3b8' }} />
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', padding: '11px 12px 11px 38px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outlineColor: '#0284c7' }}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={cargando}
            style={{ padding: '13px', background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: cargando ? 'not-allowed' : 'pointer' }}
          >
            {cargando ? 'Conectando con Firebase...' : 'Iniciar Sesión'}
          </button>
        </form>

        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={manejarRecuperacion}
            style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline' }}
          >
            ¿Cuenta comprometida o contraseña olvidada?
          </button>
        </div>
      </div>
    </div>
  );
}
export default Login;
