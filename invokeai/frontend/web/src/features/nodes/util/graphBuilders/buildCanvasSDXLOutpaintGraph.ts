import { logger } from 'app/logging/logger';
import { RootState } from 'app/store/store';
import { NonNullableGraph } from 'features/nodes/types/types';
import {
  ImageDTO,
  InfillPatchmatchInvocation,
  InfillTileInvocation,
  RandomIntInvocation,
  RangeOfSizeInvocation,
} from 'services/api/types';
import { addControlNetToLinearGraph } from './addControlNetToLinearGraph';
import { addNSFWCheckerToGraph } from './addNSFWCheckerToGraph';
import { addSDXLLoRAsToGraph } from './addSDXLLoRAstoGraph';
import { addSDXLRefinerToGraph } from './addSDXLRefinerToGraph';
import { addVAEToGraph } from './addVAEToGraph';
import { addWatermarkerToGraph } from './addWatermarkerToGraph';
import {
  CANVAS_OUTPUT,
  COLOR_CORRECT,
  INPAINT,
  INPAINT_GRAPH,
  INPAINT_IMAGE,
  INPAINT_INFILL,
  ITERATE,
  LATENTS_TO_IMAGE,
  MASK_BLUR,
  MASK_COMBINE,
  MASK_FROM_ALPHA,
  NEGATIVE_CONDITIONING,
  NOISE,
  POSITIVE_CONDITIONING,
  RANDOM_INT,
  RANGE_OF_SIZE,
  SDXL_MODEL_LOADER,
} from './constants';

/**
 * Builds the Canvas tab's Outpaint graph.
 */
export const buildCanvasSDXLOutpaintGraph = (
  state: RootState,
  canvasInitImage: ImageDTO,
  canvasMaskImage?: ImageDTO
): NonNullableGraph => {
  const log = logger('nodes');
  const {
    positivePrompt,
    negativePrompt,
    model,
    cfgScale: cfg_scale,
    scheduler,
    steps,
    img2imgStrength: strength,
    shouldFitToWidthHeight,
    iterations,
    seed,
    shouldRandomizeSeed,
    vaePrecision,
    shouldUseNoiseSettings,
    shouldUseCpuNoise,
    maskBlur,
    maskBlurMethod,
    tileSize,
    infillMethod,
  } = state.generation;

  const {
    positiveStylePrompt,
    negativeStylePrompt,
    shouldConcatSDXLStylePrompt,
    shouldUseSDXLRefiner,
    refinerStart,
  } = state.sdxl;

  if (!model) {
    log.error('No model found in state');
    throw new Error('No model found in state');
  }

  // The bounding box determines width and height, not the width and height params
  const { width, height } = state.canvas.boundingBoxDimensions;

  // We may need to set the inpaint width and height to scale the image
  const {
    scaledBoundingBoxDimensions,
    boundingBoxScaleMethod,
    shouldAutoSave,
  } = state.canvas;

  const use_cpu = shouldUseNoiseSettings
    ? shouldUseCpuNoise
    : shouldUseCpuNoise;

  let infillNode: InfillTileInvocation | InfillPatchmatchInvocation = {
    type: 'infill_tile',
    id: INPAINT_INFILL,
    is_intermediate: true,
    image: canvasInitImage,
    tile_size: tileSize,
  };

  if (infillMethod === 'patchmatch') {
    infillNode = {
      type: 'infill_patchmatch',
      id: INPAINT_INFILL,
      is_intermediate: true,
      image: canvasInitImage,
    };
  }

  const graph: NonNullableGraph = {
    id: INPAINT_GRAPH,
    nodes: {
      [SDXL_MODEL_LOADER]: {
        type: 'sdxl_model_loader',
        id: SDXL_MODEL_LOADER,
        model,
      },
      [POSITIVE_CONDITIONING]: {
        type: 'sdxl_compel_prompt',
        id: POSITIVE_CONDITIONING,
        prompt: positivePrompt,
        style: shouldConcatSDXLStylePrompt
          ? `${positivePrompt} ${positiveStylePrompt}`
          : positiveStylePrompt,
      },
      [NEGATIVE_CONDITIONING]: {
        type: 'sdxl_compel_prompt',
        id: NEGATIVE_CONDITIONING,
        prompt: negativePrompt,
        style: shouldConcatSDXLStylePrompt
          ? `${negativePrompt} ${negativeStylePrompt}`
          : negativeStylePrompt,
      },
      [infillNode.id]: infillNode,
      [INPAINT_IMAGE]: {
        type: 'i2l',
        id: INPAINT_IMAGE,
        is_intermediate: true,
        fp32: vaePrecision === 'fp32' ? true : false,
      },
      [MASK_FROM_ALPHA]: {
        type: 'tomask',
        id: MASK_FROM_ALPHA,
        is_intermediate: true,
        image: canvasInitImage,
      },
      [MASK_COMBINE]: {
        type: 'mask_combine',
        id: MASK_COMBINE,
        is_intermediate: true,
        mask2: canvasMaskImage,
      },
      [MASK_BLUR]: {
        type: 'img_blur',
        id: MASK_BLUR,
        is_intermediate: true,
        radius: maskBlur,
        blur_type: maskBlurMethod,
      },
      [NOISE]: {
        type: 'noise',
        id: NOISE,
        width,
        height,
        use_cpu,
        is_intermediate: true,
      },
      [INPAINT]: {
        type: 'denoise_latents',
        id: INPAINT,
        is_intermediate: true,
        steps: steps,
        cfg_scale: cfg_scale,
        scheduler: scheduler,
        denoising_start: 1 - strength,
        denoising_end: shouldUseSDXLRefiner ? refinerStart : 1,
      },
      [LATENTS_TO_IMAGE]: {
        type: 'l2i',
        id: LATENTS_TO_IMAGE,
        is_intermediate: true,
        fp32: vaePrecision === 'fp32' ? true : false,
      },
      [COLOR_CORRECT]: {
        type: 'color_correct',
        id: COLOR_CORRECT,
        is_intermediate: true,
      },
      [CANVAS_OUTPUT]: {
        type: 'img_paste',
        id: CANVAS_OUTPUT,
        is_intermediate: true,
      },
      [RANGE_OF_SIZE]: {
        type: 'range_of_size',
        id: RANGE_OF_SIZE,
        is_intermediate: true,
        // seed - must be connected manually
        // start: 0,
        size: iterations,
        step: 1,
      },
      [ITERATE]: {
        type: 'iterate',
        id: ITERATE,
        is_intermediate: true,
      },
    },
    edges: [
      // Connect Model Loader To UNet and CLIP
      {
        source: {
          node_id: SDXL_MODEL_LOADER,
          field: 'unet',
        },
        destination: {
          node_id: INPAINT,
          field: 'unet',
        },
      },
      {
        source: {
          node_id: SDXL_MODEL_LOADER,
          field: 'clip',
        },
        destination: {
          node_id: POSITIVE_CONDITIONING,
          field: 'clip',
        },
      },
      {
        source: {
          node_id: SDXL_MODEL_LOADER,
          field: 'clip2',
        },
        destination: {
          node_id: POSITIVE_CONDITIONING,
          field: 'clip2',
        },
      },
      {
        source: {
          node_id: SDXL_MODEL_LOADER,
          field: 'clip',
        },
        destination: {
          node_id: NEGATIVE_CONDITIONING,
          field: 'clip',
        },
      },
      {
        source: {
          node_id: SDXL_MODEL_LOADER,
          field: 'clip2',
        },
        destination: {
          node_id: NEGATIVE_CONDITIONING,
          field: 'clip2',
        },
      },
      // Infill The Image
      {
        source: {
          node_id: INPAINT_INFILL,
          field: 'image',
        },
        destination: {
          node_id: INPAINT_IMAGE,
          field: 'image',
        },
      },
      // Create mask from image alpha & merge with user painted mask
      {
        source: {
          node_id: MASK_FROM_ALPHA,
          field: 'mask',
        },
        destination: {
          node_id: MASK_COMBINE,
          field: 'mask1',
        },
      },
      {
        source: {
          node_id: MASK_COMBINE,
          field: 'image',
        },
        destination: {
          node_id: MASK_BLUR,
          field: 'image',
        },
      },
      // Connect Everything To Inpaint
      {
        source: {
          node_id: POSITIVE_CONDITIONING,
          field: 'conditioning',
        },
        destination: {
          node_id: INPAINT,
          field: 'positive_conditioning',
        },
      },
      {
        source: {
          node_id: NEGATIVE_CONDITIONING,
          field: 'conditioning',
        },
        destination: {
          node_id: INPAINT,
          field: 'negative_conditioning',
        },
      },
      {
        source: {
          node_id: NOISE,
          field: 'noise',
        },
        destination: {
          node_id: INPAINT,
          field: 'noise',
        },
      },
      {
        source: {
          node_id: INPAINT_IMAGE,
          field: 'latents',
        },
        destination: {
          node_id: INPAINT,
          field: 'latents',
        },
      },
      {
        source: {
          node_id: MASK_BLUR,
          field: 'image',
        },
        destination: {
          node_id: INPAINT,
          field: 'mask',
        },
      },
      // Iterate
      {
        source: {
          node_id: RANGE_OF_SIZE,
          field: 'collection',
        },
        destination: {
          node_id: ITERATE,
          field: 'collection',
        },
      },
      {
        source: {
          node_id: ITERATE,
          field: 'item',
        },
        destination: {
          node_id: NOISE,
          field: 'seed',
        },
      },
      // Decode inpainted latents to image
      {
        source: {
          node_id: INPAINT,
          field: 'latents',
        },
        destination: {
          node_id: LATENTS_TO_IMAGE,
          field: 'latents',
        },
      },
      // Color Correct The Inpainted Result
      {
        source: {
          node_id: INPAINT_INFILL,
          field: 'image',
        },
        destination: {
          node_id: COLOR_CORRECT,
          field: 'reference',
        },
      },
      {
        source: {
          node_id: LATENTS_TO_IMAGE,
          field: 'image',
        },
        destination: {
          node_id: COLOR_CORRECT,
          field: 'image',
        },
      },
      {
        source: {
          node_id: MASK_BLUR,
          field: 'image',
        },
        destination: {
          node_id: COLOR_CORRECT,
          field: 'mask',
        },
      },
      // Paste Back Outpainted Image on Original
      {
        source: {
          node_id: INPAINT_INFILL,
          field: 'image',
        },
        destination: {
          node_id: CANVAS_OUTPUT,
          field: 'base_image',
        },
      },
      {
        source: {
          node_id: COLOR_CORRECT,
          field: 'image',
        },
        destination: {
          node_id: CANVAS_OUTPUT,
          field: 'image',
        },
      },
      {
        source: {
          node_id: MASK_BLUR,
          field: 'image',
        },
        destination: {
          node_id: CANVAS_OUTPUT,
          field: 'mask',
        },
      },
    ],
  };

  // Add Refiner if enabled
  if (shouldUseSDXLRefiner) {
    addSDXLRefinerToGraph(state, graph, INPAINT);
  }

  // Add VAE
  addVAEToGraph(state, graph, SDXL_MODEL_LOADER);

  // handle seed
  if (shouldRandomizeSeed) {
    // Random int node to generate the starting seed
    const randomIntNode: RandomIntInvocation = {
      id: RANDOM_INT,
      type: 'rand_int',
    };

    graph.nodes[RANDOM_INT] = randomIntNode;

    // Connect random int to the start of the range of size so the range starts on the random first seed
    graph.edges.push({
      source: { node_id: RANDOM_INT, field: 'a' },
      destination: { node_id: RANGE_OF_SIZE, field: 'start' },
    });
  } else {
    // User specified seed, so set the start of the range of size to the seed
    (graph.nodes[RANGE_OF_SIZE] as RangeOfSizeInvocation).start = seed;
  }

  // add LoRA support
  addSDXLLoRAsToGraph(state, graph, INPAINT, SDXL_MODEL_LOADER);

  // add controlnet, mutating `graph`
  addControlNetToLinearGraph(state, graph, INPAINT);

  // NSFW & watermark - must be last thing added to graph
  if (state.system.shouldUseNSFWChecker) {
    // must add before watermarker!
    addNSFWCheckerToGraph(state, graph, CANVAS_OUTPUT);
  }

  if (state.system.shouldUseWatermarker) {
    // must add after nsfw checker!
    addWatermarkerToGraph(state, graph, CANVAS_OUTPUT);
  }

  return graph;
};
