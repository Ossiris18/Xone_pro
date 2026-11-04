import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { ShieldCheck, Clock, User, Activity, AlertTriangle } from 'lucide-react';

function Auditoria() {
  const [bitacora, setBitacora] = useState([]);
  const [errorFirebase, setErrorFirebase] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "Bitacora"), orderBy("fecha", "desc"), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBitacora(docs);
      setErrorFirebase(null); 
    }, (error) => {
      console.error("Error en Firebase Auditoría:", error);
      setErrorFirebase(error.message); 
    });
    return () => unsubscribe();
  }, []);

  const obtenerColorAccion = (tipo) => {
    switch(tipo) {
      case 'CREACIÓN': return { bg: '#dcfce7', text: '#16a34a' };
      case 'MODIFICACIÓN': return { bg: '#fef08a', text: '#ca8a04' };
      case 'ELIMINACIÓN': return { bg: '#fee2e2', text: '#dc2626' };
      default: return { bg: '#e0f2fe', text: '#0284c7' };
    }
  };

  return (
    <div className="auditoria-container" style={{ padding: '10px' }}>
      <div style={{ marginBottom: '30px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <div style={{ background: '#0f172a', color: '#38bdf8', padding: '15px', borderRadius: '12px' }}>
          <ShieldCheck size={30} />
        </div>
        <div>
          <h2 style={{ color: '#0f172a', margin: '0 0 5px 0' }}>Auditoría de Seguridad</h2>
          <p style={{ color: '#64748b', margin: 0 }}>Registro inmutable de actividades del personal.</p>
        </div>
      </div>

      {errorFirebase && (
        <div style={{ background: '#fef2f2', border: '1px solid #ef4444', color: '#ef4444', padding: '15px', borderRadius: '12px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertTriangle size={20} />
          <div>
            <strong>Fallo de conexión con Firebase (Posible falta de Índice compuesto):</strong>
            <p style={{ margin: 0, fontSize: '13px' }}>{errorFirebase}</p>
          </div>
        </div>
      )}

      <div style={{ background: 'white', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
        <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px', color: '#334155' }}>
          <Activity size={20}/> Historial de Movimientos
        </h3>
        
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
              <th style={{ padding: '12px', color: '#64748b', fontSize: '13px' }}><Clock size={14} style={{display:'inline', marginBottom:'-2px'}}/> Fecha y Hora</th>
              <th style={{ padding: '12px', color: '#64748b', fontSize: '13px' }}><User size={14} style={{display:'inline', marginBottom:'-2px'}}/> Empleado</th>
              <th style={{ padding: '12px', color: '#64748b', fontSize: '13px' }}>Tipo de Acción</th>
              <th style={{ padding: '12px', color: '#64748b', fontSize: '13px' }}>Detalles del Movimiento</th>
            </tr>
          </thead>
          <tbody>
            {bitacora.length === 0 && !errorFirebase ? (
              <tr><td colSpan="4" style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>No hay registros en la bitácora todavía.</td></tr>
            ) : (
              bitacora.map(log => {
                const colores = obtenerColorAccion(log.tipoAccion);
                return (
                  <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px', fontSize: '13px', color: '#475569' }}>
                      {log.fecha ? log.fecha.toDate().toLocaleString() : 'Guardando...'}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 'bold', color: '#0f172a' }}>
                      {log.nombreEmpleado} <br/><span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'normal' }}>({log.rolEmpleado})</span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ background: colores.bg, color: colores.text, padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
                        {log.tipoAccion}
                      </span>
                    </td>
                    <td style={{ padding: '12px', color: '#334155', fontSize: '14px' }}>
                      {log.detalles}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Auditoria;