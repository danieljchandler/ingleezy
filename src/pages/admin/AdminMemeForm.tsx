import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

/**
 * Memes use the same pipeline and display as Discover videos.
 * This component just redirects to AdminVideoForm with the meme flag set.
 */
const AdminMemeForm = () => {
  const navigate = useNavigate();
  const { memeId } = useParams<{ memeId: string }>();

  useEffect(() => {
    if (!memeId || memeId === 'new') {
      navigate('/admin/videos/new?meme=1', { replace: true });
    } else {
      navigate(`/admin/videos/${memeId}/edit?meme=1`, { replace: true });
    }
  }, [memeId, navigate]);

  return null;
};

export default AdminMemeForm;
