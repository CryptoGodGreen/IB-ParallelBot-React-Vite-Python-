import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './AuthExpiredModal.css';

const AuthExpiredModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLogin = () => {
    // Clear any remaining token
    localStorage.removeItem('token');
    // Navigate to login
    navigate('/login');
    onClose();
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      handleLogin();
    }
  };

  return (
    <div className="auth-expired-modal-overlay" onClick={handleOverlayClick}>
      <div className="auth-expired-modal">
        <div className="auth-expired-modal-header">
          <svg 
            className="auth-expired-modal-icon" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
            />
          </svg>
          <h2 className="auth-expired-modal-title">Session Expired</h2>
        </div>
        
        <div className="auth-expired-modal-body">
          <p className="auth-expired-modal-message">
            Your session has expired. Please log in again to continue.
          </p>
        </div>
        
        <div className="auth-expired-modal-footer">
          <button 
            className="auth-expired-modal-button"
            onClick={handleLogin}
            autoFocus
          >
            Go to Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthExpiredModal;

