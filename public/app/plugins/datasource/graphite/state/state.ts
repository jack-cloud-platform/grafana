import GraphiteQuery from '../graphite_query';
import { GraphiteActionDispatcher, GraphiteSegment, GraphiteTagOperator } from '../types';
import { GraphiteDatasource } from '../datasource';
import { TemplateSrv } from '../../../../features/templating/template_srv';
import { actions } from './actions';
import { getTemplateSrv } from '@grafana/runtime';
import {
  addSeriesByTagFunc,
  buildSegments,
  checkOtherSegments,
  emptySegments,
  fixTagSegments,
  handleTargetChanged,
  parseTarget,
  pause,
  removeTagPrefix,
  setSegmentFocus,
  smartlyHandleNewAliasByNode,
  spliceSegments,
} from './helpers';

/**
 * XXX: Work in progress.
 *
 * The state is the result of migrating properties from QueryCtrl + adding some properties that in angular where
 * internally received and processed by directives without modifying the state.
 */
export type GraphiteQueryEditorState = {
  /**
   * Extra segment with plus button when tags are rendered
   */
  addTagSegments: GraphiteSegment[];

  supportsTags: boolean;
  paused: boolean;
  removeTagValue: string;

  datasource: GraphiteDatasource;

  uiSegmentSrv: any;
  templateSrv: TemplateSrv;
  panelCtrl: any;

  target: { target: string; textEditor: boolean };

  segments: GraphiteSegment[];
  queryModel: GraphiteQuery;

  error: Error | null;

  tagsAutoCompleteErrorShown: boolean;
  metricAutoCompleteErrorShown: boolean;
};

type Action = {
  type: string;
  payload: any;
};

const reducer = async (action: Action, state: GraphiteQueryEditorState): Promise<GraphiteQueryEditorState> => {
  state = { ...state };

  if (actions.init.match(action)) {
    const deps = action.payload;
    deps.target.target = deps.target.target || '';

    state = {
      ...state,
      ...deps,
      queryModel: new GraphiteQuery(deps.datasource, deps.target, getTemplateSrv()),
      supportsTags: deps.datasource.supportsTags,
      paused: false,
      removeTagValue: '-- remove tag --',
    };

    await state.datasource.waitForFuncDefsLoaded();
    await buildSegments(state, false);
  }
  if (actions.segmentValueChanged.match(action)) {
    const { segment, index: segmentIndex } = action.payload;

    state.error = null;
    state.queryModel.updateSegmentValue(segment, segmentIndex);

    // If segment changes and first function is fake then remove all functions
    // TODO: fake function is created when the first argument is not seriesList, for
    // example constantLine(number) - which seems to be broken now.
    if (state.queryModel.functions.length > 0 && state.queryModel.functions[0].def.fake) {
      state.queryModel.functions = [];
    }

    if (segment.type === 'tag') {
      const tag = removeTagPrefix(segment.value);
      pause(state);
      await addSeriesByTagFunc(state, tag);
      return state;
    }

    if (segment.expandable) {
      await checkOtherSegments(state, segmentIndex + 1);
      setSegmentFocus(state, segmentIndex + 1);
      handleTargetChanged(state);
    } else {
      spliceSegments(state, segmentIndex + 1);
    }

    setSegmentFocus(state, segmentIndex + 1);
    handleTargetChanged(state);
  }
  if (actions.tagChanged.match(action)) {
    const { tag, index: tagIndex } = action.payload;
    state.queryModel.updateTag(tag, tagIndex);
    handleTargetChanged(state);
  }
  if (actions.addNewTag.match(action)) {
    const segment = action.payload.segment;
    const newTagKey = segment.value;
    const newTag = { key: newTagKey, operator: '=' as GraphiteTagOperator, value: '' };
    state.queryModel.addTag(newTag);
    handleTargetChanged(state);
    fixTagSegments(state);
  }
  if (actions.unpause.match(action)) {
    state.paused = false;
    state.panelCtrl.refresh();
  }
  if (actions.addFunction.match(action)) {
    const newFunc = state.datasource.createFuncInstance(action.payload.name, {
      withDefaultParams: true,
    });
    newFunc.added = true;
    state.queryModel.addFunction(newFunc);
    smartlyHandleNewAliasByNode(state, newFunc);

    if (state.segments.length === 1 && state.segments[0].fake) {
      emptySegments(state);
    }

    if (!newFunc.params.length && newFunc.added) {
      handleTargetChanged(state);
    }

    if (newFunc.def.name === 'seriesByTag') {
      await parseTarget(state);
    }
  }
  if (actions.removeFunction.match(action)) {
    state.queryModel.removeFunction(action.payload.funcDef);
    handleTargetChanged(state);
  }
  if (actions.moveFunction.match(action)) {
    const { funcDef, offset } = action.payload;
    state.queryModel.moveFunction(funcDef, offset);
    handleTargetChanged(state);
  }
  if (actions.targetChanged.match(action)) {
    handleTargetChanged(state);
  }
  if (actions.toggleEditorMode.match(action)) {
    state.target.textEditor = !state.target.textEditor;
    await parseTarget(state);
  }

  return { ...state };
};

export const createStore = (
  onChange: (state: GraphiteQueryEditorState) => void
): [GraphiteActionDispatcher, GraphiteQueryEditorState] => {
  let state = {} as GraphiteQueryEditorState;

  const dispatch = async (action: Action) => {
    state = await reducer(action, state);
    onChange(state);
  };

  return [dispatch, state];
};