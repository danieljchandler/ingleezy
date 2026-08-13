import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ImageUploaderProps {
  currentUrl?: string | null;
  onUpload: (url: string) => void;
  onRemove: () => void;
}

// Target dimensions for 4:3 aspect ratio cards
const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 600;

/**
 * Resizes an image to fit within the target dimensions while maintaining aspect ratio
 * NO CROPPING - the entire image is preserved, with letterboxing if needed
 */
const resizeImage = async (file: File): Promise<Blob> => {
  // Released on every path — success, decode failure and canvas failure alike.
  // Nothing revoked it before, so each source blob stayed pinned for the life of
  // the document and an admin working through a batch of cards accumulated
  // every original they had touched, at full size, on top of the resized copies.
  const sourceUrl = URL.createObjectURL(file);
  try {
    return await decodeAndResize(sourceUrl);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};

const decodeAndResize = (sourceUrl: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = () => {
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      // Calculate scaling to fit entire image (no cropping)
      const sourceRatio = img.width / img.height;
      const targetRatio = TARGET_WIDTH / TARGET_HEIGHT;

      let destWidth: number;
      let destHeight: number;
      let destX: number;
      let destY: number;

      if (sourceRatio > targetRatio) {
        // Image is wider - fit to width, letterbox top/bottom
        destWidth = TARGET_WIDTH;
        destHeight = TARGET_WIDTH / sourceRatio;
        destX = 0;
        destY = (TARGET_HEIGHT - destHeight) / 2;
      } else {
        // Image is taller - fit to height, letterbox left/right
        destHeight = TARGET_HEIGHT;
        destWidth = TARGET_HEIGHT * sourceRatio;
        destX = (TARGET_WIDTH - destWidth) / 2;
        destY = 0;
      }

      // Set canvas to target size
      canvas.width = TARGET_WIDTH;
      canvas.height = TARGET_HEIGHT;

      // Fill with warm sand background to match the app theme
      ctx.fillStyle = '#F5F0E8';
      ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);

      // Draw the entire image (no cropping)
      ctx.drawImage(
        img,
        0, 0, img.width, img.height,
        destX, destY, destWidth, destHeight
      );

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        },
        'image/jpeg',
        0.9 // Quality
      );
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = sourceUrl;
  });
};

export const ImageUploader = ({ currentUrl, onUpload, onRemove }: ImageUploaderProps) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl || null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Admin forms fetch the record they are editing, so this component routinely
  // mounts with `currentUrl` undefined and is handed the real URL a moment
  // later. Reading the prop only in `useState` meant the field went on offering
  // "Click to upload image" over a record that already had one — so the admin
  // uploaded a second copy and orphaned the first in the bucket.
  useEffect(() => {
    setPreview(currentUrl || null);
  }, [currentUrl]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: 'Invalid file',
        description: 'Please select an image file.',
      });
      return;
    }

    // Validate file size (max 10MB before resize)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'File too large',
        description: 'Please select an image under 10MB.',
      });
      return;
    }

    setUploading(true);

    try {
      // Resize image to fit 4:3 aspect ratio
      toast({ title: 'Resizing image...' });
      const resizedBlob = await resizeImage(file);
      
      const fileName = `${crypto.randomUUID()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('flashcard-images')
        .upload(fileName, resizedBlob, {
          contentType: 'image/jpeg',
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('flashcard-images')
        .getPublicUrl(fileName);

      setPreview(publicUrl);
      onUpload(publicUrl);
      toast({ title: 'Image uploaded and resized to 800×600!' });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    onRemove();
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="hidden"
        id="image-upload"
      />

      {preview ? (
        <div className="relative aspect-[4/3] w-full max-w-xs mx-auto rounded-xl overflow-hidden bg-muted">
          <img
            src={preview}
            alt="Preview"
            className="w-full h-full object-cover"
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2"
            onClick={handleRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label
          htmlFor="image-upload"
          className="flex flex-col items-center justify-center aspect-[4/3] w-full max-w-xs mx-auto rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">Click to upload image</span>
              <span className="text-xs text-muted-foreground mt-1">Auto-resized to 800×600 (4:3)</span>
            </>
          )}
        </label>
      )}
    </div>
  );
};
