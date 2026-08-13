import { useNavigate } from "react-router-dom";
import { useAdminDiscoverVideos, useDeleteDiscoverVideo, useTogglePublish } from "@/hooks/useDiscoverVideos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Plus, Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { formatDuration } from "@/lib/videoEmbed";

const AdminVideos = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: videos, isLoading } = useAdminDiscoverVideos();
  const deleteMutation = useDeleteDiscoverVideo();
  const togglePublish = useTogglePublish();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold">Manage Videos</h1>
          </div>
          <Button onClick={() => navigate("/admin/videos/new")}>
            <Plus className="h-4 w-4 mr-2" />
            Add Video
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {videos && videos.length > 0 ? (
          <div className="space-y-3">
            {videos.map((video) => (
              <Card key={video.id} className="flex items-center">
                <CardContent className="flex-1 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {video.thumbnail_url && (
                      <img
                        src={video.thumbnail_url}
                        alt=""
                        className="w-20 h-12 object-cover rounded"
                      />
                    )}
                    <div>
                      <h3 className="font-semibold">{video.title}</h3>
                      <div className="flex gap-1.5 mt-1">
                        <Badge variant="outline" className="text-xs">{video.dialect}</Badge>
                        <Badge variant="outline" className="text-xs">{video.difficulty}</Badge>
                        <Badge variant="outline" className="text-xs capitalize">{video.platform}</Badge>
                        {video.duration_seconds && (
                          <Badge variant="outline" className="text-xs">
                            {formatDuration(video.duration_seconds)}
                          </Badge>
                        )}
                        <Badge variant={video.published ? "default" : "secondary"} className="text-xs">
                          {video.published ? "Published" : "Draft"}
                        </Badge>
                        {video.transcription_status === 'pending' && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            Queued
                          </Badge>
                        )}
                        {video.transcription_status === 'processing' && (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Transcribing
                          </Badge>
                        )}
                        {video.transcription_status === 'failed' && (
                          <Badge variant="destructive" className="text-xs">
                            Failed
                          </Badge>
                        )}
                        {video.transcription_status === 'completed' && !video.published && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                            Ready to review
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        togglePublish.mutate(
                          { id: video.id, published: !video.published },
                          {
                            onSuccess: () =>
                              toast({
                                title: video.published ? "Unpublished" : "Published",
                              }),
                          }
                        )
                      }
                    >
                      {video.published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => navigate(`/admin/videos/${video.id}/edit`)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(video.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-4">No videos yet. Add your first video!</p>
              <Button onClick={() => navigate("/admin/videos/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Add Video
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Video?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this video. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) {
                  deleteMutation.mutate(deleteId, {
                    onSuccess: () => {
                      toast({ title: "Video deleted" });
                      setDeleteId(null);
                    },
                    onError: (err: any) => {
                      toast({ variant: "destructive", title: "Error", description: err.message });
                    },
                  });
                }
              }}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminVideos;
