import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { Calendar, Users, Mail, User, School, Lock, Trash2, CheckCircle, ChevronLeft, LogOut } from 'lucide-react';

// --- FIREBASE SETUP ---
// We gebruiken de voorziene omgevingsvariabelen voor de configuratie
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    // Dummy config for local preview if needed, usually injected by the platform
    apiKey: "dummy", authDomain: "dummy", projectId: "dummy", storageBucket: "dummy", messagingSenderId: "dummy", appId: "dummy"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'hospiteer-reservaties';

// --- CONSTANTEN ---
const SESSIONS = [
    { id: 'sessie-1', name: 'Sessie 1: 4 december 2024', day: '4 december 2024', time: '09:30 - 11:50' },
    { id: 'sessie-2', name: 'Sessie 2: Vrijdag 4 december', day: 'Vrijdag 4 december', time: '12:30 - 14:25' },
    { id: 'sessie-3', name: 'Sessie 3: Maandag 7 december', day: 'Maandag 7 december', time: '12:30 - 14:25' },
    { id: 'sessie-4', name: 'Sessie 4: Donderdag 10 december', day: 'Donderdag 10 december', time: '12:00 - 14:25' },
];
const MAX_CAPACITY = 4;
const ADMIN_PIN = '1234';

export default function App() {
    // --- STATE ---
    const [user, setUser] = useState(null);
    const [reservations, setReservations] = useState([]);
    const [view, setView] = useState('public'); // 'public', 'admin_login', 'admin_dashboard'
    const [loading, setLoading] = useState(true);
    const [notification, setNotification] = useState(null); // { type: 'success'|'error', text: string }

    // Formulier State
    const [formData, setFormData] = useState({
        schoolName: '',
        grade: '',
        studentCount: '',
        contactName: '',
        email: '',
        sessionId: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Admin State
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState(false);

    // --- FIREBASE INITIALISATIE & AUTH ---
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Fout bij authenticatie:", error);
                setNotification({ type: 'error', text: 'Kon geen verbinding maken met het systeem.' });
            }
        };
        initAuth();

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });

        return () => unsubscribe();
    }, []);

    // --- DATA OPHALEN ---
    useEffect(() => {
        if (!user) return;

        // Vaste path structuur volgens de regels: /artifacts/{appId}/public/data/{collectionName}
        const reservationsRef = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
        
        // We luisteren real-time naar wijzigingen
        const unsubscribe = onSnapshot(reservationsRef, 
            (snapshot) => {
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                // Sorteer lokaal op tijdstip van inschrijving (als fallback)
                data.sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));
                setReservations(data);
                setLoading(false);
            },
            (error) => {
                console.error("Fout bij ophalen reservaties:", error);
                setNotification({ type: 'error', text: 'Fout bij het ophalen van gegevens.' });
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user]);

    // --- LOGICA & BEREKENINGEN ---
    
    // Bereken beschikbaarheid per sessie
    const sessionStats = useMemo(() => {
        const stats = {};
        SESSIONS.forEach(s => {
            stats[s.id] = { count: 0, isFull: false };
        });
        
        reservations.forEach(res => {
            if (stats[res.sessionId]) {
                stats[res.sessionId].count += 1;
            }
        });

        Object.keys(stats).forEach(id => {
            stats[id].isFull = stats[id].count >= MAX_CAPACITY;
        });

        return stats;
    }, [reservations]);

    // Groepeer reservaties voor het admin paneel
    const groupedReservations = useMemo(() => {
        const grouped = {};
        SESSIONS.forEach(s => { grouped[s.id] = []; });
        reservations.forEach(res => {
            if (grouped[res.sessionId]) {
                grouped[res.sessionId].push(res);
            }
        });
        return grouped;
    }, [reservations]);

    // --- HANDLERS ---

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const showNotification = (type, text) => {
        setNotification({ type, text });
        setTimeout(() => setNotification(null), 5000);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!user) {
            showNotification('error', 'U bent niet geauthenticeerd.');
            return;
        }

        if (!formData.sessionId) {
            showNotification('error', 'Selecteer a.u.b. een sessie.');
            return;
        }

        // Extra check op de client om te zien of het echt niet vol is vlak voor submit
        if (sessionStats[formData.sessionId]?.isFull) {
            showNotification('error', 'Sorry, deze sessie is zojuist volzet geraakt.');
            setFormData(prev => ({ ...prev, sessionId: '' })); // Reset selectie
            return;
        }

        setIsSubmitting(true);
        try {
            const reservationsRef = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
            await addDoc(reservationsRef, {
                ...formData,
                timestamp: serverTimestamp(),
                userId: user.uid // Optioneel, maar goed voor tracking
            });
            
            showNotification('success', 'Uw reservatie is succesvol ontvangen!');
            setFormData({
                schoolName: '', grade: '', studentCount: '', contactName: '', email: '', sessionId: ''
            });
        } catch (error) {
            console.error("Fout bij opslaan:", error);
            showNotification('error', 'Er liep iets mis bij het opslaan van uw reservatie.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAdminLogin = (e) => {
        e.preventDefault();
        if (pinInput === ADMIN_PIN) {
            setView('admin_dashboard');
            setPinInput('');
            setPinError(false);
        } else {
            setPinError(true);
        }
    };

    const handleDeleteReservation = async (reservationId) => {
        if (!user) return;
        // Geen window.confirm gebruiken zoals gevraagd in de regels, we doen het direct of met een custom UI.
        // Voor de eenvoud van de demo verwijderen we het direct.
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'reservations', reservationId);
            await deleteDoc(docRef);
            showNotification('success', 'Reservatie succesvol geannuleerd.');
        } catch (error) {
            console.error("Fout bij verwijderen:", error);
            showNotification('error', 'Kon de reservatie niet annuleren.');
        }
    };

    // --- COMPONENTEN (Weergave) ---

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-200">
            {/* Navigatie Balk */}
            <nav className="bg-white shadow-sm border-b border-slate-200">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <School className="h-6 w-6 text-blue-600" />
                        <span className="font-bold text-lg tracking-tight text-slate-900">Atheneum GO! 4 Business</span>
                    </div>
                    <div>
                        {view === 'public' ? (
                            <button 
                                onClick={() => setView('admin_login')}
                                className="text-sm font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors"
                            >
                                <Lock className="h-4 w-4" /> Beheer
                            </button>
                        ) : (
                            <button 
                                onClick={() => setView('public')}
                                className="text-sm font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors"
                            >
                                {view === 'admin_dashboard' ? <LogOut className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />} 
                                Terug naar website
                            </button>
                        )}
                    </div>
                </div>
            </nav>

            {/* Notificaties */}
            {notification && (
                <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 transition-all duration-300 ${notification.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                    {notification.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                    <span className="font-medium">{notification.text}</span>
                </div>
            )}

            <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                
                {/* --- PUBLIEKE WEERGAVE --- */}
                {view === 'public' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        
                        {/* Info & Beschikbaarheid Kolom */}
                        <div className="lg:col-span-5 space-y-6">
                            <div>
                                <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Welkom basisscholen!</h1>
                                <p className="text-slate-600">
                                    Schrijf uw klas in voor één van onze hospiteerdagen. Ontdek onze school, volg proeflessen en ervaar de sfeer. Per sessie kunnen we maximaal 4 groepen ontvangen om de kwaliteit te garanderen.
                                </p>
                            </div>

                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                                    <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                        <Calendar className="h-5 w-5 text-blue-500" />
                                        Beschikbare Sessies
                                    </h2>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {SESSIONS.map(session => {
                                        const stats = sessionStats[session.id] || { count: 0, isFull: false };
                                        const availableSpots = MAX_CAPACITY - stats.count;
                                        
                                        return (
                                            <div key={session.id} className="p-4 sm:px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                                <div>
                                                    <p className="font-medium text-slate-900">{session.day} - {session.name.split(' - ')[1]}</p>
                                                    <p className="text-sm text-slate-500">{session.time}</p>
                                                </div>
                                                <div>
                                                    {stats.isFull ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                                            VOLZET
                                                        </span>
                                                    ) : (
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${availableSpots <= 1 ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                                                            {availableSpots} {availableSpots === 1 ? 'plaats' : 'plaatsen'} vrij
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Inschrijfformulier Kolom */}
                        <div className="lg:col-span-7">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sm:p-8">
                                <h2 className="text-xl font-bold text-slate-900 mb-6">Inschrijfformulier</h2>
                                
                                <form onSubmit={handleSubmit} className="space-y-6">
                                    {/* Sessie Selectie */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-2">Kies een sessie *</label>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {SESSIONS.map(session => {
                                                const isFull = sessionStats[session.id]?.isFull;
                                                const isSelected = formData.sessionId === session.id;
                                                return (
                                                    <label 
                                                        key={session.id}
                                                        className={`
                                                            relative border rounded-lg p-4 flex cursor-pointer focus:outline-none transition-all
                                                            ${isFull ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200' : 'hover:border-blue-300'}
                                                            ${isSelected ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 bg-white'}
                                                        `}
                                                    >
                                                        <input 
                                                            type="radio" 
                                                            name="sessionId" 
                                                            value={session.id}
                                                            checked={isSelected}
                                                            onChange={handleInputChange}
                                                            disabled={isFull}
                                                            className="sr-only"
                                                        />
                                                        <div className="flex-1">
                                                            <p className={`font-medium ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
                                                                {session.name.split(': ')[1]}
                                                            </p>
                                                            <p className={`text-sm ${isSelected ? 'text-blue-700' : 'text-slate-500'}`}>
                                                                {session.time}
                                                            </p>
                                                        </div>
                                                        {isSelected && <CheckCircle className="h-5 w-5 text-blue-600 absolute top-4 right-4" />}
                                                    </label>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* School & Klas */}
                                        <div className="space-y-1">
                                            <label htmlFor="schoolName" className="block text-sm font-medium text-slate-700">Naam Basisschool *</label>
                                            <div className="relative rounded-md shadow-sm">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <School className="h-4 w-4 text-slate-400" />
                                                </div>
                                                <input required type="text" id="schoolName" name="schoolName" value={formData.schoolName} onChange={handleInputChange} className="block w-full pl-10 sm:text-sm border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-2 border" placeholder="Vb. De Springplank" />
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label htmlFor="grade" className="block text-sm font-medium text-slate-700">Klas / Leerjaar *</label>
                                            <input required type="text" id="grade" name="grade" value={formData.grade} onChange={handleInputChange} className="block w-full sm:text-sm border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-2 px-3 border" placeholder="Vb. 6A" />
                                        </div>

                                        {/* Contact & Leerlingen */}
                                        <div className="space-y-1">
                                            <label htmlFor="contactName" className="block text-sm font-medium text-slate-700">Naam Leerkracht *</label>
                                            <div className="relative rounded-md shadow-sm">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <User className="h-4 w-4 text-slate-400" />
                                                </div>
                                                <input required type="text" id="contactName" name="contactName" value={formData.contactName} onChange={handleInputChange} className="block w-full pl-10 sm:text-sm border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-2 border" placeholder="Vb. Jan Peeters" />
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label htmlFor="studentCount" className="block text-sm font-medium text-slate-700">Aantal Leerlingen *</label>
                                            <div className="relative rounded-md shadow-sm">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <Users className="h-4 w-4 text-slate-400" />
                                                </div>
                                                <input required type="number" min="1" max="100" id="studentCount" name="studentCount" value={formData.studentCount} onChange={handleInputChange} className="block w-full pl-10 sm:text-sm border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-2 border" placeholder="0" />
                                            </div>
                                        </div>

                                        {/* Email */}
                                        <div className="space-y-1 md:col-span-2">
                                            <label htmlFor="email" className="block text-sm font-medium text-slate-700">E-mailadres *</label>
                                            <div className="relative rounded-md shadow-sm">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <Mail className="h-4 w-4 text-slate-400" />
                                                </div>
                                                <input required type="email" id="email" name="email" value={formData.email} onChange={handleInputChange} className="block w-full pl-10 sm:text-sm border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-2 border" placeholder="jan@despringplank.be" />
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1">Hiernaartoe sturen we de bevestiging en verdere info.</p>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-slate-100">
                                        <button 
                                            type="submit" 
                                            disabled={isSubmitting}
                                            className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                                        >
                                            {isSubmitting ? 'Bezig met inschrijven...' : 'Bevestig Inschrijving'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                )}


                {/* --- ADMIN LOGIN WEERGAVE --- */}
                {view === 'admin_login' && (
                    <div className="max-w-md mx-auto mt-10 bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
                        <div className="mx-auto w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                            <Lock className="h-6 w-6 text-slate-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">Beheerders Login</h2>
                        <p className="text-slate-500 mb-6 text-sm">Voer de pincode in om de reservaties te beheren.</p>
                        
                        <form onSubmit={handleAdminLogin} className="space-y-4">
                            <div>
                                <input 
                                    type="password" 
                                    value={pinInput}
                                    onChange={(e) => setPinInput(e.target.value)}
                                    placeholder="••••"
                                    className={`block w-full text-center tracking-widest text-2xl py-3 rounded-md border ${pinError ? 'border-red-300 ring-1 ring-red-300 focus:ring-red-500 focus:border-red-500' : 'border-slate-300 focus:ring-blue-500 focus:border-blue-500'}`}
                                    autoFocus
                                />
                                {pinError && <p className="text-red-500 text-sm mt-2">Onjuiste pincode.</p>}
                            </div>
                            <button type="submit" className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900">
                                Inloggen
                            </button>
                        </form>
                    </div>
                )}


                {/* --- ADMIN DASHBOARD WEERGAVE --- */}
                {view === 'admin_dashboard' && (
                    <div className="space-y-8">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">Overzicht Reservaties</h1>
                                <p className="text-slate-500 text-sm">Totaal {reservations.length} groepen ingeschreven.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            {SESSIONS.map(session => {
                                const sessionReservations = groupedReservations[session.id] || [];
                                const count = sessionReservations.length;
                                
                                return (
                                    <div key={session.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                                        <div className="bg-slate-800 px-6 py-4 flex items-center justify-between">
                                            <h3 className="font-semibold text-white">{session.name}</h3>
                                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${count >= MAX_CAPACITY ? 'bg-red-500 text-white' : 'bg-slate-600 text-slate-200'}`}>
                                                {count} / {MAX_CAPACITY}
                                            </span>
                                        </div>
                                        
                                        <div className="flex-1 p-0">
                                            {count === 0 ? (
                                                <div className="p-8 text-center text-slate-500 text-sm italic">
                                                    Nog geen inschrijvingen voor deze sessie.
                                                </div>
                                            ) : (
                                                <ul className="divide-y divide-slate-100">
                                                    {sessionReservations.map(res => (
                                                        <li key={res.id} className="p-4 sm:px-6 hover:bg-slate-50 group">
                                                            <div className="flex justify-between items-start">
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-semibold text-slate-900">{res.schoolName}</span>
                                                                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{res.grade}</span>
                                                                    </div>
                                                                    <div className="text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                                                                        <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {res.contactName}</span>
                                                                        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {res.studentCount} lln</span>
                                                                        <span className="flex items-center gap-1 text-blue-600"><Mail className="h-3.5 w-3.5" /> <a href={`mailto:${res.email}`} className="hover:underline">{res.email}</a></span>
                                                                    </div>
                                                                    <div className="text-xs text-slate-400 mt-2">
                                                                        Ingeschreven op: {res.timestamp ? new Date(res.timestamp.toDate()).toLocaleString('nl-BE') : 'Zojuist'}
                                                                    </div>
                                                                </div>
                                                                <button 
                                                                    onClick={() => handleDeleteReservation(res.id)}
                                                                    className="text-slate-300 hover:text-red-500 transition-colors p-2 rounded-md hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                    title="Verwijder reservatie"
                                                                >
                                                                    <Trash2 className="h-5 w-5" />
                                                                </button>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}