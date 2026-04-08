"""
Identity Authentication Module

Implements user identity binding and anti-cheating detection.

Author: SSP Team
"""

from __future__ import annotations

import logging
import time
import os
import json
import cv2
import numpy as np
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

from .types import WarningReason


logger = logging.getLogger(__name__)

# Face data storage directory
# Project structure: e:\project\SSP\focus_island\user_faces\user_{email_prefix}\
# __file__ = e:\project\SSP\focus_island\src\focus_island\auth.py
# Go up two levels: src -> focus_island(project root) -> e:\project\SSP
# Then enter focus_island/user_faces
FACE_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "user_faces"
)


def sanitize_filename(name: str) -> str:
    """
    Sanitize filename, remove illegal characters
    
    Args:
        name: Original name (e.g., email prefix)
        
    Returns:
        Safe filename
    """
    # Replace illegal characters
    illegal_chars = ['@', '.', '/', '\\', ':', '*', '?', '"', '<', '>', '|', ' ']
    safe_name = name
    for char in illegal_chars:
        safe_name = safe_name.replace(char, '_')
    
    # Remove consecutive underscores
    while '__' in safe_name:
        safe_name = safe_name.replace('__', '_')
    
    # Remove leading/trailing underscores
    safe_name = safe_name.strip('_')
    
    return safe_name if safe_name else "unknown_user"


def get_user_face_folder(user_id: str) -> str:
    """
    Get user face folder path
    
    Args:
        user_id: User ID (usually email prefix)
        
    Returns:
        Folder path
    """
    safe_name = sanitize_filename(user_id)
    return os.path.join(FACE_DATA_DIR, f"user_{safe_name}")


@dataclass
class UserProfile:
    """User profile"""
    user_id: str
    seat_id: str                      # Seat ID
    embedding: np.ndarray             # Baseline feature vector (512-dim)
    registered_at: datetime = field(default_factory=datetime.now)
    last_verified: datetime = field(default_factory=datetime.now)
    verification_count: int = 0
    failed_verifications: int = 0
    total_sessions: int = 0
    
    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "seat_id": self.seat_id,
            "embedding_norm": float(np.linalg.norm(self.embedding)),
            "registered_at": self.registered_at.isoformat(),
            "last_verified": self.last_verified.isoformat(),
            "verification_count": self.verification_count,
            "failed_verifications": self.failed_verifications,
            "total_sessions": self.total_sessions
        }


@dataclass 
class VerificationResult:
    """Identity verification result"""
    is_verified: bool
    similarity: float                 # Cosine similarity
    threshold: float                 # Decision threshold
    is_cheating: bool               # Is cheating
    message: str
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> dict:
        return {
            "is_verified": self.is_verified,
            "similarity": round(self.similarity, 4),
            "threshold": self.threshold,
            "is_cheating": self.is_cheating,
            "message": self.message,
            "timestamp": self.timestamp
        }


class IdentityAuthenticator:
    """Identity Authenticator
    
    Manages user identity binding and real-time identity verification.
    Uses 512-dim feature vectors extracted by ArcFace for cosine similarity comparison.
    """
    
    def __init__(
        self,
        similarity_threshold: float = 0.6,
        cheating_threshold: float = 0.5,
        verification_interval: float = 60.0,  # Verify every 60 seconds
        max_failed_verifications: int = 3
    ):
        """
        Initialize identity authenticator
        
        Args:
            similarity_threshold: Similarity threshold for verification pass (default 0.6)
            cheating_threshold: Similarity threshold for person swap detection (default 0.5)
            verification_interval: Auto verification interval (seconds)
            max_failed_verifications: Max consecutive verification failures allowed
        """
        self.similarity_threshold = similarity_threshold
        self.cheating_threshold = cheating_threshold
        self.verification_interval = verification_interval
        self.max_failed_verifications = max_failed_verifications
        
        # Current bound user
        self.current_user: Optional[UserProfile] = None
        
        # Verification state
        self._last_verification_time = 0.0
        self._consecutive_failures = 0
        self._is_locked = False
        
        logger.info(
            f"IdentityAuthenticator initialized: "
            f"threshold={similarity_threshold}, "
            f"cheating_threshold={cheating_threshold}, "
            f"interval={verification_interval}s"
        )
    
    def bind_user(
        self,
        user_id: str,
        seat_id: str,
        embedding: np.ndarray
    ) -> UserProfile:
        """
        Bind user identity (Stage 1)
        
        When user clicks "Start Focus", extract feature vector and bind to seat.
        
        Args:
            user_id: User ID
            seat_id: Seat ID
            embedding: 512-dim feature vector extracted by ArcFace
            
        Returns:
            UserProfile object
        """
        # Create user profile
        profile = UserProfile(
            user_id=user_id,
            seat_id=seat_id,
            embedding=embedding.copy(),
            registered_at=datetime.now(),
            last_verified=datetime.now()
        )
        
        self.current_user = profile
        self._last_verification_time = time.time()
        self._consecutive_failures = 0
        self._is_locked = False
        
        logger.info(
            f"User bound: user_id={user_id}, seat_id={seat_id}, "
            f"embedding_norm={np.linalg.norm(embedding):.4f}"
        )
        
        return profile
    
    def verify_identity(
        self,
        current_embedding: np.ndarray
    ) -> VerificationResult:
        """
        Verify if current face matches registered user (anti-cheating)
        
        Args:
            current_embedding: 512-dim feature vector extracted from current frame
            
        Returns:
            VerificationResult object
        """
        if self.current_user is None:
            return VerificationResult(
                is_verified=False,
                similarity=0.0,
                threshold=self.similarity_threshold,
                is_cheating=False,
                message="No user bound"
            )
        
        # Calculate cosine similarity
        similarity = self._cosine_similarity(
            self.current_user.embedding,
            current_embedding
        )
        
        # Update verification statistics
        self.current_user.verification_count += 1
        self.current_user.last_verified = datetime.now()
        self._last_verification_time = time.time()
        
        # Determine result
        if similarity >= self.similarity_threshold:
            # Verification passed
            self._consecutive_failures = 0
            self.current_user.failed_verifications = 0
            
            return VerificationResult(
                is_verified=True,
                similarity=similarity,
                threshold=self.similarity_threshold,
                is_cheating=False,
                message="Identity verified"
            )
        
        elif similarity >= self.cheating_threshold:
            # Verification failed but not detected as person swap
            self._consecutive_failures += 1
            self.current_user.failed_verifications = self._consecutive_failures
            
            return VerificationResult(
                is_verified=False,
                similarity=similarity,
                threshold=self.similarity_threshold,
                is_cheating=False,
                message=f"Verification failed ({self._consecutive_failures}/{self.max_failed_verifications})"
            )
        
        else:
            # Detected as person swap / cheating
            self._consecutive_failures += 1
            self._is_locked = True
            
            return VerificationResult(
                is_verified=False,
                similarity=similarity,
                threshold=self.similarity_threshold,
                is_cheating=True,
                message="CHEATING DETECTED: Face mismatch (possible person swap)"
            )
    
    def should_verify(self) -> bool:
        """Check if automatic verification is needed"""
        if self.current_user is None:
            return False
        
        elapsed = time.time() - self._last_verification_time
        return elapsed >= self.verification_interval
    
    def is_locked(self) -> bool:
        """Check if locked (cheating detected)"""
        return self._is_locked
    
    def unlock(self) -> None:
        """Release lock"""
        self._is_locked = False
        self._consecutive_failures = 0
        logger.info("Authentication unlocked")
    
    def unbind_user(self) -> Optional[UserProfile]:
        """
        Unbind current user

        Returns:
            Previous user profile
        """
        old_user = self.current_user
        
        if old_user:
            old_user.total_sessions += 1
            logger.info(f"User unbound: user_id={old_user.user_id}, total_sessions={old_user.total_sessions}")
        
        self.current_user = None
        self._is_locked = False
        self._consecutive_failures = 0
        
        return old_user
    
    def save_user_face_data(
        self,
        user_id: str,
        face_image: np.ndarray,
        embedding: np.ndarray,
        metadata: Optional[dict] = None
    ) -> dict:
        """
        Save user face data to local folder
        
        Saves:
        - Face image (cropped)
        - 512-dim feature vector (.npy)
        - Metadata (.json)
        
        Args:
            user_id: User ID (email prefix)
            face_image: Face image (cropped)
            embedding: 512-dim feature vector
            metadata: Additional metadata
            
        Returns:
            Save result
        """
        try:
            # Create user-specific folder using email prefix
            safe_name = sanitize_filename(user_id)
            user_folder = os.path.join(FACE_DATA_DIR, f"user_{safe_name}")
            os.makedirs(user_folder, exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            
            # 1. Save face image
            face_path = os.path.join(user_folder, f"face_{timestamp}.jpg")
            if face_image is not None and face_image.size > 0:
                cv2.imwrite(face_path, face_image)
            
            # 2. Save feature vector
            embedding_path = os.path.join(user_folder, "embedding.npy")
            np.save(embedding_path, embedding)
            
            # 3. Save metadata
            meta_data = {
                "user_id": user_id,
                "safe_name": safe_name,
                "saved_at": timestamp,
                "face_image_path": face_path,
                "embedding_shape": list(embedding.shape),
                "embedding_norm": float(np.linalg.norm(embedding)),
                "metadata": metadata or {}
            }
            meta_path = os.path.join(user_folder, "metadata.json")
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(meta_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Face data saved: {user_folder}")
            
            return {
                "success": True,
                "folder": user_folder,
                "safe_name": safe_name,
                "face_image": face_path,
                "embedding": embedding_path,
                "metadata": meta_path
            }
            
        except Exception as e:
            logger.error(f"Failed to save face data: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def load_user_face_data(self, user_id: str) -> Optional[dict]:
        """
        Load user face data from local folder
        
        Args:
            user_id: User ID (will be sanitized)
            
        Returns:
            User data dict or None
        """
        try:
            # Use sanitize_filename to ensure path consistency
            safe_name = sanitize_filename(user_id)
            user_folder = os.path.join(FACE_DATA_DIR, f"user_{safe_name}")
            meta_path = os.path.join(user_folder, "metadata.json")
            embedding_path = os.path.join(user_folder, "embedding.npy")
            
            if not os.path.exists(meta_path):
                logger.debug(f"Face data not found for user: {user_id} (safe: {safe_name})")
                return None
            
            # Load metadata
            with open(meta_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            # Load feature vector
            embedding = np.load(embedding_path)
            
            return {
                "metadata": metadata,
                "embedding": embedding,
                "folder": user_folder,
                "safe_name": safe_name
            }
            
        except Exception as e:
            logger.error(f"Failed to load face data for {user_id}: {e}")
            return None
    
    def get_saved_users(self) -> list:
        """
        Get all saved user list
        
        Returns:
            User ID list
        """
        try:
            if not os.path.exists(FACE_DATA_DIR):
                return []
            
            folders = [d for d in os.listdir(FACE_DATA_DIR) 
                      if os.path.isdir(os.path.join(FACE_DATA_DIR, d))]
            
            users = []
            for folder in folders:
                if folder.startswith("user_"):
                    user_id = folder[5:]
                    users.append(user_id)
            
            return users
            
        except Exception as e:
            logger.error(f"Failed to get saved users: {e}")
            return []
    
    def verify_face(
        self,
        current_embedding: np.ndarray,
        user_id: Optional[str] = None
    ) -> dict:
        """
        Verify if face matches saved face
        
        Args:
            current_embedding: Current detected face feature vector
            user_id: Specified user ID (optional, if not specified, try to match all saved users)
            
        Returns:
            Verification result dict:
            - is_verified: Verification passed
            - matched_user: Matched user ID
            - similarity: Similarity
            - is_bound: User has bound face
            - message: Message
        """
        result = {
            "is_verified": False,
            "matched_user": None,
            "similarity": 0.0,
            "is_bound": False,
            "message": "No face registered"
        }
        
        # If user ID is specified, only verify that user
        if user_id:
            user_data = self.load_user_face_data(user_id)
            if user_data is None:
                result["message"] = "User not bound"
                return result
            
            result["is_bound"] = True
            similarity = self._cosine_similarity(
                user_data["embedding"],
                current_embedding
            )
            result["similarity"] = similarity
            
            if similarity >= self.similarity_threshold:
                result["is_verified"] = True
                result["matched_user"] = user_id
                result["message"] = "Identity verified"
            elif similarity >= self.cheating_threshold:
                result["message"] = "Similarity too low"
            else:
                result["message"] = "Face mismatch - possible cheating"
            
            return result
        
        # If no user ID specified, try to match all saved users
        saved_users = self.get_saved_users()
        if not saved_users:
            result["message"] = "No registered users"
            return result
        
        best_match = None
        best_similarity = 0.0
        
        for saved_user in saved_users:
            user_data = self.load_user_face_data(saved_user)
            if user_data is None:
                continue
            
            similarity = self._cosine_similarity(
                user_data["embedding"],
                current_embedding
            )
            
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = saved_user
        
        result["similarity"] = best_similarity
        
        if best_match and best_similarity >= self.similarity_threshold:
            result["is_verified"] = True
            result["matched_user"] = best_match
            result["is_bound"] = True
            result["message"] = "Identity verified"
        elif best_similarity >= self.cheating_threshold:
            result["is_bound"] = True
            result["message"] = "Similarity too low"
        else:
            result["message"] = "No matching face found"
        
        return result
    
    def has_bound_face(self, user_id: str) -> bool:
        """
        Check if user has bound face
        
        Args:
            user_id: User ID (email prefix)
            
        Returns:
            Is bound
        """
        safe_name = sanitize_filename(user_id)
        user_folder = os.path.join(FACE_DATA_DIR, f"user_{safe_name}")
        meta_path = os.path.join(user_folder, "metadata.json")
        return os.path.exists(meta_path)
    
    def delete_user_face_data(self, user_id: str) -> dict:
        """
        Delete user's face data
        
        Args:
            user_id: User ID (email prefix)
            
        Returns:
            Delete result
        """
        try:
            safe_name = sanitize_filename(user_id)
            user_folder = os.path.join(FACE_DATA_DIR, f"user_{safe_name}")
            
            if not os.path.exists(user_folder):
                return {"success": False, "error": "User folder not found"}
            
            # Delete all files in folder
            import shutil
            shutil.rmtree(user_folder)
            
            logger.info(f"Deleted face data for user: {user_id} (safe: {safe_name})")
            
            return {"success": True, "folder": user_folder, "safe_name": safe_name}
            
        except Exception as e:
            logger.error(f"Failed to delete face data: {e}")
            return {"success": False, "error": str(e)}
    
    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """
        Calculate cosine similarity between two vectors
        
        Args:
            a, b: Two vectors, same shape
            
        Returns:
            Cosine similarity [-1, 1]
        """
        # Assume vectors are already L2 normalized
        # cos_sim = dot(a, b) / (||a|| * ||b||)
        # For normalized vectors, simplified to dot(a, b)
        
        dot_product = np.dot(a, b)
        
        # Ensure in [-1, 1] range (handle floating point error)
        return float(np.clip(dot_product, -1.0, 1.0))
    
    def get_current_user_info(self) -> Optional[dict]:
        """Get current user info"""
        if self.current_user is None:
            return None
        
        return {
            "user_id": self.current_user.user_id,
            "seat_id": self.current_user.seat_id,
            "is_locked": self._is_locked,
            "consecutive_failures": self._consecutive_failures,
            "time_since_last_verification": round(time.time() - self._last_verification_time, 1),
            "total_verifications": self.current_user.verification_count,
            "failed_verifications": self.current_user.failed_verifications
        }
    
    def update_thresholds(
        self,
        similarity_threshold: Optional[float] = None,
        cheating_threshold: Optional[float] = None,
        verification_interval: Optional[float] = None
    ) -> None:
        """Update authentication thresholds"""
        if similarity_threshold is not None:
            self.similarity_threshold = similarity_threshold
        if cheating_threshold is not None:
            self.cheating_threshold = cheating_threshold
        if verification_interval is not None:
            self.verification_interval = verification_interval
        
        logger.info(
            f"Thresholds updated: "
            f"similarity={self.similarity_threshold}, "
            f"cheating={self.cheating_threshold}, "
            f"interval={self.verification_interval}s"
        )


def create_test_embedding(seed: int = 42) -> np.ndarray:
    """Create test feature vector (for development testing)"""
    np.random.seed(seed)
    vec = np.random.randn(512).astype(np.float32)
    vec = vec / np.linalg.norm(vec)  # L2 normalization
    return vec
